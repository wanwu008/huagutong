'use strict'

/**
 * gh-proxy - GitHub release/archive/file acceleration proxy
 * Adapted for Vercel Serverless Functions
 * Supports both path-based and query param (?q=) URL formats
 */

const PREFIX = '/'
const Config = {
    jsdelivr: 0
}

const whiteList = []

const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return { statusCode: status, headers, body }
}

function checkUrl(u) {
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
        if (u.search(i) === 0) return true
    }
    return false
}

async function httpHandler(pathname, method, reqHeaders, body) {
    if (method === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'access-control-allow-origin': '*',
                'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
                'access-control-max-age': '1728000',
                'access-control-allow-headers': reqHeaders['access-control-request-headers'] || '*'
            }
        }
    }

    let urlStr = pathname
    let flag = !Boolean(whiteList.length)
    for (let i of whiteList) {
        if (urlStr.includes(i)) { flag = true; break }
    }
    if (!flag) return makeRes('blocked', 403)
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }

    try {
        const fetchHeaders = { ...reqHeaders }
        delete fetchHeaders['host']
        delete fetchHeaders['connection']
        const fetchOpts = {
            method,
            headers: fetchHeaders,
            redirect: 'manual'
        }
        if (body && method !== 'GET' && method !== 'HEAD') {
            fetchOpts.body = body
        }

        const res = await fetch(urlStr, fetchOpts)
        const resHeaders = {}
        for (const [k, v] of res.headers.entries()) {
            resHeaders[k] = v
        }

        if (resHeaders['location']) {
            let location = resHeaders['location']
            if (checkUrl(location)) {
                resHeaders['location'] = PREFIX + location
            } else {
                const redirectRes = await fetch(location, { method, redirect: 'follow' })
                const redirectHeaders = {}
                for (const [k, v] of redirectRes.headers.entries()) {
                    redirectHeaders[k] = v
                }
                redirectHeaders['access-control-expose-headers'] = '*'
                redirectHeaders['access-control-allow-origin'] = '*'
                delete redirectHeaders['content-security-policy']
                delete redirectHeaders['content-security-policy-report-only']
                delete redirectHeaders['clear-site-data']
                const redirectBuffer = await redirectRes.arrayBuffer()
                return {
                    statusCode: redirectRes.status,
                    headers: redirectHeaders,
                    body: Buffer.from(redirectBuffer)
                }
            }
        }

        resHeaders['access-control-expose-headers'] = '*'
        resHeaders['access-control-allow-origin'] = '*'
        delete resHeaders['content-security-policy']
        delete resHeaders['content-security-policy-report-only']
        delete resHeaders['clear-site-data']

        const resBuffer = await res.arrayBuffer()
        return {
            statusCode: res.status,
            headers: resHeaders,
            body: Buffer.from(resBuffer)
        }
    } catch (err) {
        return makeRes('proxy error:\\n' + err.stack, 502)
    }
}

module.exports = async (req, res) => {
    const method = req.method
    const urlStr = req.url
    let path = ''

    // Mode 1: query param ?q=URL
    const qParam = req.query?.q
    if (qParam) {
        path = qParam
    } else {
        // Mode 2: path-based URL
        path = urlStr.slice(PREFIX.length)
        // Fix Vercel URL normalization: https:/ -> https://
        path = path.replace(/^(https?):\/([^/])/, '$1://$2')
    }

    if (path.search(exp1) === 0 || path.search(exp5) === 0 || path.search(exp6) === 0 || path.search(exp3) === 0) {
        const result = await httpHandler(path, method, req.headers, req.body)
        res.writeHead(result.statusCode, result.headers)
        res.end(result.body)
        return
    } else if (path.search(exp2) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
            res.writeHead(302, { Location: newUrl })
            res.end()
            return
        } else {
            path = path.replace('/blob/', '/raw/')
            const result = await httpHandler(path, method, req.headers, req.body)
            res.writeHead(result.statusCode, result.headers)
            res.end(result.body)
            return
        }
    } else if (path.search(exp4) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1').replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
            res.writeHead(302, { Location: newUrl })
            res.end()
            return
        } else {
            const result = await httpHandler(path, method, req.headers, req.body)
            res.writeHead(result.statusCode, result.headers)
            res.end(result.body)
            return
        }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(getIndexHtml())
        return
    }
}

function getIndexHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GitHub \u6587\u4ef6\u52a0\u901f</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#f6f8fa;color:#24292e;padding:20px}
.container{max-width:640px;margin:40px auto;background:#fff;border-radius:6px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
h1{text-align:center;font-size:24px;margin-bottom:8px}
.desc{text-align:center;color:#586069;font-size:14px;margin-bottom:24px}
.input-group{display:flex;gap:8px}
input{flex:1;padding:8px 12px;border:1px solid #d1d5da;border-radius:4px;font-size:14px;outline:none}
input:focus{border-color:#0366d6;box-shadow:0 0 0 2px rgba(3,102,214,.3)}
button{padding:8px 16px;background:#0366d6;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer}
button:hover{background:#0050a0}
.result{margin-top:16px;padding:12px;border:1px solid #d1d5da;border-radius:4px;background:#f6f8fa;font-size:14px;word-break:break-all;display:none}
.result a{color:#0366d6}
.usage{margin-top:24px;font-size:13px;color:#586069;line-height:1.8}
.usage h3{margin-bottom:8px;color:#24292e;font-size:15px}
.usage ul{list-style:disc;padding-left:20px}
footer{text-align:center;margin-top:40px;color:#586069;font-size:12px}
</style>
</head>
<body>
<div class="container">
<h1>GitHub \u6587\u4ef6\u52a0\u901f</h1>
<p class="desc">GitHub Release\u3001Archive \u4ee5\u53ca\u9879\u76ee\u6587\u4ef6\u7684\u52a0\u901f\u4e0b\u8f7d</p>
<div class="input-group">
<input id="url" placeholder="\u7c98\u8d34 GitHub \u6587\u4ef6\u94fe\u63a5" autofocus>
<button onclick="accelerate()">\u52a0\u901f</button>
</div>
<div id="result" class="result"></div>
<div class="usage">
<h3>\u652f\u6301\u7684\u94fe\u63a5\u683c\u5f0f</h3>
<ul>
<li>Release \u6587\u4ef6\uff1ahttps://github.com/user/repo/releases/download/v1.0/file.zip</li>
<li>Archive\uff1ahttps://github.com/user/repo/archive/master.zip</li>
<li>\u5206\u652f\u6587\u4ef6\uff1ahttps://github.com/user/repo/blob/master/file</li>
<li>Raw \u6587\u4ef6\uff1ahttps://raw.githubusercontent.com/user/repo/master/file</li>
</ul>
<h3>\u4f7f\u7528\u65b9\u5f0f</h3>
<p>\u65b9\u5f0f\u4e00\uff08\u63a8\u8350\uff09\uff1a\u4f7f\u7528 ?q= \u53c2\u6570</p>
<p>https://gh.vipwzt.com/?q=https://github.com/user/repo/releases/download/v1.0/file.zip</p>
<p>\u65b9\u5f0f\u4e8c\uff1a\u76f4\u63a5\u62fc\u63a5</p>
<p>https://gh.vipwzt.com/https://github.com/user/repo/releases/download/v1.0/file.zip</p>
</div>
</div>
<footer>gh-proxy | Powered by Vercel</footer>
<script>
function accelerate(){
  const url=document.getElementById("url").value.trim()
  if(!url){alert("\u8bf7\u8f93\u5165\u94fe\u63a5");return}
  const host=location.origin+"/?q="
  const result=host+encodeURIComponent(url)
  const el=document.getElementById("result")
  el.style.display="block"
  el.innerHTML="\u52a0\u901f\u94fe\u63a5\uff1a<a href=\""+result+"\" target=\"_blank\">"+result+"</a>"
}
</script>
</body>
</html>`
}
