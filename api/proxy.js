'use strict'

/**
 * gh-proxy - GitHub release/archive/file acceleration proxy
 * Adapted for Vercel Serverless Functions
 */

const ASSET_URL = ''  // Empty: serve local public/index.html
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
    return {
        statusCode: status,
        headers: headers,
        body: body
    }
}

function checkUrl(u) {
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
        if (u.search(i) === 0) {
            return true
        }
    }
    return false
}

async function httpHandler(pathname, method, reqHeaders, body) {
    // preflight
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
        if (urlStr.includes(i)) {
            flag = true
            break
        }
    }
    if (!flag) {
        return makeRes("blocked", 403)
    }
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }

    try {
        const fetchHeaders = { ...reqHeaders }
        delete fetchHeaders['host']
        delete fetchHeaders['connection']

        const fetchOpts = {
            method: method,
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
                // Follow redirect
                const redirectRes = await fetch(location, { method: method, redirect: 'follow' })
                const redirectHeaders = {}
                for (const [k, v] of redirectRes.headers.entries()) {
                    redirectHeaders[k] = v
                }
                redirectHeaders['access-control-expose-headers'] = '*'
                redirectHeaders['access-control-allow-origin'] = '*'
                delete redirectHeaders['content-security-policy']
                delete redirectHeaders['content-security-policy-report-only']
                delete redirectHeaders['clear-site-data']
                const redirectBody = await redirectRes.text()
                return {
                    statusCode: redirectRes.status,
                    headers: redirectHeaders,
                    body: redirectBody
                }
            }
        }

        resHeaders['access-control-expose-headers'] = '*'
        resHeaders['access-control-allow-origin'] = '*'
        delete resHeaders['content-security-policy']
        delete resHeaders['content-security-policy-report-only']
        delete resHeaders['clear-site-data']

        const resBody = await res.text()
        return {
            statusCode: res.status,
            headers: resHeaders,
            body: resBody
        }
    } catch (err) {
        return makeRes('proxy error:\n' + err.stack, 502)
    }
}

module.exports = async (req, res) => {
    const method = req.method
    const urlStr = req.url
    let path = ''

    // Check query param q= for redirect
    const qParam = req.query?.q
    if (qParam) {
        const host = req.headers.host || ''
        const redirectUrl = 'https://' + host + PREFIX + qParam
        res.writeHead(301, { Location: redirectUrl })
        res.end()
        return
    }

    // Extract path after PREFIX - fix: properly handle the URL protocol
    path = urlStr.slice(PREFIX.length)
    // Remove leading slashes and normalize multiple slashes after protocol
    path = path.replace(/^\/+/, '')
    // Ensure protocol has exactly two slashes
    path = path.replace(/^(https?):\/+(.*)/, '$1://$2')

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
        // Serve the static index page
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
<title>GitHub 文件加速</title>
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
<h1>GitHub 文件加速</h1>
<p class="desc">GitHub Release、Archive 以及项目文件的加速下载</p>
<div class="input-group">
<input id="url" placeholder="粘贴 GitHub 文件链接" autofocus>
<button onclick="accelerate()">加速</button>
</div>
<div id="result" class="result"></div>
<div class="usage">
<h3>支持的链接格式</h3>
<ul>
<li>Release 文件：https://github.com/user/repo/releases/download/v1.0/file.zip</li>
<li>Archive：https://github.com/user/repo/archive/master.zip</li>
<li>分支文件：https://github.com/user/repo/blob/master/file</li>
<li>Raw 文件：https://raw.githubusercontent.com/user/repo/master/file</li>
<li>Gist：https://gist.githubusercontent.com/user/id/raw/file</li>
</ul>
<h3>使用方式</h3>
<p>在原链接前加上本站地址即可，例如：</p>
<p>https://github.com/user/repo/releases/download/v1.0/file.zip → https://你的域名/https://github.com/user/repo/releases/download/v1.0/file.zip</p>
</div>
</div>
<footer>gh-proxy | Powered by Vercel</footer>
<script>
function accelerate(){
  const url=document.getElementById('url').value.trim()
  if(!url){alert('请输入链接');return}
  const host=location.origin+'/'
  const result=host+url
  const el=document.getElementById('result')
  el.style.display='block'
  el.innerHTML='加速链接：<a href="'+result+'" target="_blank">'+result+'</a>'
}
</script>
</body>
</html>`
}
