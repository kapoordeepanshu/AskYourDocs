/*!
 * AskYourDocs website widget.
 *
 *   <script src="https://YOUR-INSTANCE/widget.js" data-key="wk_..." async></script>
 *
 * Optional attributes:
 *   data-position="left"   dock bottom-left instead of bottom-right
 *   data-open="true"       start with the panel open
 *
 * One dependency-free file. Everything renders inside a shadow root, so the
 * host page's CSS cannot restyle the widget and the widget's CSS cannot leak
 * into the page. All text from the server is inserted with textContent, never
 * as HTML.
 */
;(function () {
  'use strict'

  var script = document.currentScript
  if (!script) return
  var key = script.getAttribute('data-key')
  if (!key) {
    console.warn('[askyourdocs] widget.js needs a data-key attribute.')
    return
  }
  if (window.__askyourdocsWidgets && window.__askyourdocsWidgets[key]) return
  window.__askyourdocsWidgets = window.__askyourdocsWidgets || {}
  window.__askyourdocsWidgets[key] = true

  var base = new URL(script.src, location.href).origin
  var position = script.getAttribute('data-position') === 'left' ? 'left' : 'right'
  var startOpen = script.getAttribute('data-open') === 'true'
  var storageKey = 'askyourdocs:' + key

  // ── Persistence ────────────────────────────────────────────────────────
  // Session storage keeps the conversation while the visitor moves between
  // pages of the site, and forgets it when they close the tab. It can throw
  // (privacy modes, blocked storage), and the widget must still work then.

  function loadState() {
    try {
      var raw = sessionStorage.getItem(storageKey)
      if (raw) return JSON.parse(raw)
    } catch (e) {}
    return { conversationId: null, messages: [], open: false }
  }

  function saveState() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state))
    } catch (e) {}
  }

  var state = loadState()
  var config = null
  var busy = false

  // ── Styles ─────────────────────────────────────────────────────────────

  function readableOn(hex) {
    var n = parseInt(hex.slice(1), 16)
    var r = (n >> 16) & 255
    var g = (n >> 8) & 255
    var b = n & 255
    var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return lum > 0.6 ? '#111827' : '#ffffff'
  }

  function css(accent) {
    return (
      ':host{all:initial;--accent:' + accent + ';--accent-fg:' + readableOn(accent) + ';' +
      '--bg:#ffffff;--surface:#f4f5f7;--border:#e3e5ea;--text:#1d2129;--muted:#6b7280;' +
      '--warn:#b45309;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;' +
      'font-size:15px;line-height:1.5;color:var(--text)}' +
      '@media (prefers-color-scheme:dark){:host{--bg:#1b1d22;--surface:#24272e;--border:#343842;' +
      '--text:#eceef2;--muted:#a0a6b1;--warn:#f0b35a}}' +
      '*{box-sizing:border-box}' +
      'button{font:inherit;color:inherit;cursor:pointer}' +
      '.launcher{position:fixed;bottom:20px;' + position + ':20px;z-index:2147483000;width:56px;height:56px;' +
      'border-radius:50%;border:0;background:var(--accent);color:var(--accent-fg);display:grid;place-items:center;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.18);transition:transform .15s}' +
      '.launcher:hover{transform:scale(1.05)}' +
      '.launcher:focus-visible,.panel :focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
      '.panel{position:fixed;bottom:88px;' + position + ':20px;z-index:2147483000;width:380px;' +
      'max-width:calc(100vw - 32px);height:min(600px,calc(100vh - 120px));display:flex;flex-direction:column;' +
      'background:var(--bg);border:1px solid var(--border);border-radius:16px;overflow:hidden;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.2)}' +
      '.panel[hidden]{display:none}' +
      '@media (max-width:480px){.panel{inset:0;width:auto;max-width:none;height:auto;border-radius:0;border:0}' +
      '.launcher.is-open{display:none}}' +
      '.head{display:flex;align-items:center;gap:8px;padding:14px 16px;background:var(--accent);color:var(--accent-fg)}' +
      '.head h2{flex:1;margin:0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.icon-btn{border:0;background:transparent;color:inherit;width:32px;height:32px;border-radius:8px;' +
      'display:grid;place-items:center}' +
      '.icon-btn:hover{background:rgba(127,127,127,.18)}' +
      '.log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}' +
      '.msg{max-width:88%;padding:10px 13px;border-radius:14px;word-wrap:break-word;overflow-wrap:anywhere}' +
      '.msg.user{align-self:flex-end;background:var(--accent);color:var(--accent-fg);border-bottom-right-radius:4px;white-space:pre-wrap}' +
      '.msg.bot{align-self:flex-start;background:var(--surface);border-bottom-left-radius:4px}' +
      '.msg p{margin:0}.msg p+p,.msg ul+p,.msg p+ul{margin-top:8px}' +
      '.msg ul{margin:0;padding-left:20px}' +
      '.status{color:var(--muted);font-size:13px}' +
      '.cite{border:0;background:var(--accent);color:var(--accent-fg);font-size:10.5px;font-weight:600;' +
      'line-height:1;min-width:17px;height:17px;padding:0 4px;border-radius:9px;vertical-align:super;margin-left:2px}' +
      '.partial{text-decoration:underline dotted var(--warn);text-underline-offset:3px}' +
      '.note{margin-top:8px;font-size:12.5px;color:var(--muted)}' +
      '.sources{margin-top:10px;border-top:1px solid var(--border);padding-top:8px;display:flex;flex-direction:column;gap:4px}' +
      '.sources-label{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}' +
      '.source button{width:100%;text-align:left;border:0;background:transparent;padding:4px 0;font-size:13px;' +
      'display:flex;gap:6px;align-items:baseline}' +
      '.source button:hover .src-title{text-decoration:underline}' +
      '.src-n{font-weight:600;color:var(--accent);flex:none}' +
      '.src-loc{color:var(--muted)}' +
      '.excerpt{margin:4px 0 6px;padding:8px 10px;border-left:3px solid var(--accent);background:var(--bg);' +
      'border-radius:6px;font-size:13px;color:var(--text);white-space:pre-wrap}' +
      '.excerpt[hidden]{display:none}' +
      '.source.flash .excerpt{animation:flash 1s}' +
      '@keyframes flash{from{background:color-mix(in srgb,var(--accent) 22%,var(--bg))}}' +
      '.form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);background:var(--bg)}' +
      'textarea{flex:1;resize:none;font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);' +
      'border-radius:10px;padding:9px 11px;max-height:120px;min-height:40px}' +
      'textarea:focus{outline:none;border-color:var(--accent)}' +
      '.send{border:0;border-radius:10px;background:var(--accent);color:var(--accent-fg);width:42px;flex:none;' +
      'display:grid;place-items:center}' +
      '.send:disabled{opacity:.5;cursor:default}' +
      '.foot{padding:0 12px 10px;font-size:11.5px;color:var(--muted);text-align:center;background:var(--bg)}' +
      '.foot a{color:inherit}' +
      '.dots span{display:inline-block;width:6px;height:6px;margin-right:3px;border-radius:50%;background:var(--muted);' +
      'animation:pulse 1.2s infinite ease-in-out}' +
      '.dots span:nth-child(2){animation-delay:.15s}.dots span:nth-child(3){animation-delay:.3s}' +
      '@keyframes pulse{0%,80%,100%{opacity:.25}40%{opacity:1}}' +
      '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
    )
  }

  // ── DOM helpers ────────────────────────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  var SVG_NS = 'http://www.w3.org/2000/svg'
  function icon(paths, size) {
    var svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', size || 22)
    svg.setAttribute('height', size || 22)
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    paths.forEach(function (d) {
      var path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', d)
      svg.appendChild(path)
    })
    return svg
  }
  var CHAT_ICON = ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z']
  var CLOSE_ICON = ['M18 6 6 18', 'M6 6l12 12']
  var SEND_ICON = ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4z']
  var RESET_ICON = ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5']

  // ── Answer rendering ───────────────────────────────────────────────────

  var CITATION = /\[(\d{1,2})\]/g
  var LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/

  function stripMarkers(text) {
    return text.replace(CITATION, '').replace(/\*\*/g, '').replace(/[ \t]{2,}/g, ' ')
  }

  /** Appends text to `parent`, turning **bold** into <strong> and [n] into citation buttons. */
  function appendInline(parent, text, sources, onCite) {
    var pattern = /\*\*([^*]+)\*\*|\[(\d{1,2})\]/g
    var last = 0
    var match
    while ((match = pattern.exec(text))) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)))
      if (match[1] !== undefined) {
        parent.appendChild(el('strong', null, match[1]))
      } else {
        var n = Number(match[2])
        if (sources.some(function (s) { return s.n === n })) {
          var button = el('button', 'cite', String(n))
          button.type = 'button'
          button.setAttribute('aria-label', 'Show source ' + n)
          button.addEventListener('click', onCite.bind(null, n))
          parent.appendChild(button)
        }
      }
      last = pattern.lastIndex
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)))
  }

  /**
   * Rebuilds paragraphs and lists from verified segments. Segments on the same
   * line join into one paragraph; a gap in line numbers is a paragraph break.
   */
  function renderSegments(container, segments, sources, onCite) {
    var lines = []
    segments.forEach(function (segment) {
      if (!segment.text.trim()) return
      var current = lines[lines.length - 1]
      if (!current || current.line !== segment.line) {
        current = { line: segment.line, items: [] }
        lines.push(current)
      }
      current.items.push(segment)
    })

    var list = null
    lines.forEach(function (line) {
      var isList = LIST_ITEM.test(line.items[0].text)
      var block
      if (isList) {
        if (!list) {
          list = el('ul')
          container.appendChild(list)
        }
        block = el('li')
        list.appendChild(block)
      } else {
        list = null
        block = el('p')
        if (/^#{1,6}\s+/.test(line.items[0].text)) block.style.fontWeight = '600'
        container.appendChild(block)
      }

      line.items.forEach(function (segment, index) {
        var text = segment.text.replace(LIST_ITEM, '').replace(/^#{1,6}\s+/, '')
        var target = block
        if (segment.verdict === 'partial') {
          target = el('span', 'partial')
          target.title = 'Only partly confirmed by the source'
          block.appendChild(target)
        }
        if (index > 0) block.insertBefore(document.createTextNode(' '), target === block ? null : target)
        appendInline(target, text, sources, onCite)
      })
    })
  }

  function citedNumbers(segments) {
    var found = []
    segments.forEach(function (segment) {
      var match
      CITATION.lastIndex = 0
      while ((match = CITATION.exec(segment.text))) {
        var n = Number(match[1])
        if (found.indexOf(n) === -1) found.push(n)
      }
    })
    return found
  }

  function renderSources(container, sources, numbers) {
    var shown = sources.filter(function (s) { return numbers.indexOf(s.n) !== -1 })
    if (shown.length === 0) return null

    var box = el('div', 'sources')
    box.appendChild(el('div', 'sources-label', shown.length === 1 ? 'Source' : 'Sources'))
    var byNumber = {}

    shown.forEach(function (source) {
      var item = el('div', 'source')
      var button = el('button')
      button.type = 'button'
      button.setAttribute('aria-expanded', 'false')
      button.appendChild(el('span', 'src-n', source.n + '.'))
      var label = el('span')
      label.appendChild(el('span', 'src-title', source.title))
      if (source.location) label.appendChild(el('span', 'src-loc', ' · ' + source.location))
      button.appendChild(label)

      var excerpt = el('div', 'excerpt', source.excerpt.trim() + (source.excerpt.length >= 320 ? '…' : ''))
      excerpt.hidden = true

      button.addEventListener('click', function () {
        excerpt.hidden = !excerpt.hidden
        button.setAttribute('aria-expanded', String(!excerpt.hidden))
      })

      item.appendChild(button)
      item.appendChild(excerpt)
      box.appendChild(item)
      byNumber[source.n] = { item: item, excerpt: excerpt, button: button }
    })

    container.appendChild(box)
    return byNumber
  }

  function renderBotMessage(bubble, message) {
    bubble.textContent = ''

    if (!message.segments) {
      // A refusal, an error, or the greeting: plain text.
      message.text.split(/\n{2,}/).forEach(function (part) {
        bubble.appendChild(el('p', null, stripMarkers(part).trim()))
      })
      return
    }

    var sourceNodes = null
    function onCite(n) {
      var node = sourceNodes && sourceNodes[n]
      if (!node) return
      node.excerpt.hidden = false
      node.button.setAttribute('aria-expanded', 'true')
      node.item.classList.remove('flash')
      void node.item.offsetWidth
      node.item.classList.add('flash')
      node.item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }

    renderSegments(bubble, message.segments, message.sources || [], onCite)

    if (message.removed > 0) {
      bubble.appendChild(
        el(
          'p',
          'note',
          message.removed === 1
            ? 'One statement was left out because it could not be confirmed in our information.'
            : message.removed + ' statements were left out because they could not be confirmed in our information.',
        ),
      )
    }

    sourceNodes = renderSources(bubble, message.sources || [], citedNumbers(message.segments))
  }

  // ── Build ──────────────────────────────────────────────────────────────

  function build() {
    var host = el('div')
    host.setAttribute('data-askyourdocs', '')
    var root = host.attachShadow({ mode: 'open' })
    var style = el('style', null, css(config.accentColor))
    root.appendChild(style)

    var launcher = el('button', 'launcher')
    launcher.type = 'button'
    launcher.setAttribute('aria-label', 'Open chat: ' + config.title)
    launcher.setAttribute('aria-haspopup', 'dialog')
    launcher.appendChild(icon(CHAT_ICON, 26))

    var panel = el('div', 'panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', config.title)
    panel.hidden = true

    var head = el('div', 'head')
    head.appendChild(el('h2', null, config.title))
    var reset = el('button', 'icon-btn')
    reset.type = 'button'
    reset.title = 'Start over'
    reset.setAttribute('aria-label', 'Start a new conversation')
    reset.appendChild(icon(RESET_ICON, 18))
    var close = el('button', 'icon-btn')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close chat')
    close.appendChild(icon(CLOSE_ICON, 20))
    head.appendChild(reset)
    head.appendChild(close)

    var log = el('div', 'log')
    log.setAttribute('aria-live', 'polite')

    var form = el('form', 'form')
    var input = el('textarea')
    input.rows = 1
    input.maxLength = 1000
    input.placeholder = 'Type your question…'
    input.setAttribute('aria-label', 'Your question')
    var send = el('button', 'send')
    send.type = 'submit'
    send.setAttribute('aria-label', 'Send')
    send.appendChild(icon(SEND_ICON, 18))
    form.appendChild(input)
    form.appendChild(send)

    var foot = el('div', 'foot')
    foot.appendChild(document.createTextNode('Answers come from our own information, with sources.'))

    panel.appendChild(head)
    panel.appendChild(log)
    panel.appendChild(form)
    panel.appendChild(foot)
    root.appendChild(launcher)
    root.appendChild(panel)
    document.body.appendChild(host)

    function scrollToEnd() {
      log.scrollTop = log.scrollHeight
    }

    function addBubble(role) {
      var bubble = el('div', 'msg ' + role)
      log.appendChild(bubble)
      return bubble
    }

    function renderAll() {
      log.textContent = ''
      renderBotMessage(addBubble('bot'), { text: config.greeting })
      state.messages.forEach(function (message) {
        if (message.role === 'user') addBubble('user').textContent = message.text
        else renderBotMessage(addBubble('bot'), message)
      })
      scrollToEnd()
    }

    function setOpen(open) {
      state.open = open
      saveState()
      panel.hidden = !open
      launcher.classList.toggle('is-open', open)
      launcher.setAttribute('aria-expanded', String(open))
      launcher.setAttribute('aria-label', (open ? 'Close chat: ' : 'Open chat: ') + config.title)
      if (open) {
        scrollToEnd()
        input.focus()
      }
    }

    launcher.addEventListener('click', function () {
      setOpen(panel.hidden)
    })
    close.addEventListener('click', function () {
      setOpen(false)
      launcher.focus()
    })
    reset.addEventListener('click', function () {
      if (busy) return
      state.conversationId = null
      state.messages = []
      saveState()
      renderAll()
      input.focus()
    })
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setOpen(false)
        launcher.focus()
      }
    })

    input.addEventListener('input', function () {
      input.style.height = 'auto'
      input.style.height = Math.min(input.scrollHeight, 120) + 'px'
    })
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit'))
      }
    })

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var question = input.value.trim()
      if (!question || busy) return
      input.value = ''
      input.style.height = 'auto'
      ask(question)
    })

    var STAGE_TEXT = {
      retrieving: 'Looking that up…',
      reading: 'Reading…',
      writing: 'Writing…',
      checking: 'Checking the answer against its sources…',
    }

    function ask(question) {
      busy = true
      send.disabled = true

      state.messages.push({ role: 'user', text: question })
      saveState()
      addBubble('user').textContent = question

      var bubble = addBubble('bot')
      var dots = el('span', 'dots')
      dots.appendChild(el('span'))
      dots.appendChild(el('span'))
      dots.appendChild(el('span'))
      bubble.appendChild(dots)
      scrollToEnd()

      var message = { role: 'bot', text: '', sources: [], segments: null, removed: 0 }
      var status = null
      var streamed = null

      function showStatus(text) {
        if (!status) {
          bubble.textContent = ''
          streamed = el('p')
          status = el('p', 'status')
          bubble.appendChild(streamed)
          bubble.appendChild(status)
        }
        status.textContent = text
      }

      function finish(failed) {
        if (status && status.parentNode) status.parentNode.removeChild(status)
        if (failed) {
          // A stale or unknown conversation is the usual cause; start clean.
          state.conversationId = null
        } else {
          state.messages.push(message)
        }
        saveState()
        renderBotMessage(bubble, message)
        scrollToEnd()
        busy = false
        send.disabled = false
        input.focus()
      }

      function fail(text) {
        message = { role: 'bot', text: text, segments: null }
        finish(true)
      }

      function handle(event) {
        switch (event.type) {
          case 'status':
            showStatus(STAGE_TEXT[event.stage] || '')
            break
          case 'meta':
            state.conversationId = event.conversationId
            message.sources = event.sources
            break
          case 'delta':
            message.text += event.text
            showStatus(status ? status.textContent : '')
            streamed.textContent = stripMarkers(message.text)
            scrollToEnd()
            break
          case 'final':
            message.segments = event.segments
            message.removed = event.removed
            break
          case 'done':
            if (event.refused) message.segments = null
            finish(false)
            return true
          case 'error':
            fail(event.message)
            return true
        }
        return false
      }

      fetch(base + '/api/widget/' + encodeURIComponent(key) + '/chat', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: question,
          conversationId: state.conversationId || undefined,
        }),
      })
        .then(function (response) {
          if (!response.ok || !response.body) {
            return response
              .json()
              .catch(function () { return null })
              .then(function (body) {
                fail((body && body.error && body.error.message) || 'Something went wrong. Please try again.')
              })
          }

          var reader = response.body.getReader()
          var decoder = new TextDecoder()
          var buffer = ''
          var ended = false

          function pump() {
            return reader.read().then(function (result) {
              if (result.done) {
                if (!ended) fail('The connection was interrupted. Please try again.')
                return
              }
              buffer += decoder.decode(result.value, { stream: true })
              var frames = buffer.split('\n\n')
              buffer = frames.pop()
              for (var i = 0; i < frames.length && !ended; i++) {
                var line = frames[i].trim()
                if (line.indexOf('data: ') !== 0) continue
                try {
                  ended = handle(JSON.parse(line.slice(6)))
                } catch (e) {}
              }
              if (ended) {
                reader.cancel().catch(function () {})
                return
              }
              return pump()
            })
          }
          return pump()
        })
        .catch(function () {
          if (busy) fail('Could not reach the chat. Check your connection and try again.')
        })
    }

    renderAll()
    if (state.open || startOpen) setOpen(true)
  }

  // ── Boot ───────────────────────────────────────────────────────────────

  function boot() {
    fetch(base + '/api/widget/' + encodeURIComponent(key), { credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then(function (body) {
        config = body.widget
        build()
      })
      .catch(function (error) {
        // Fail quietly on the host page: a missing chat bubble is better than
        // a broken one. The console says why, for whoever installed it.
        console.warn(
          '[askyourdocs] widget not loaded (' + error.message + '). Check data-key and that ' +
            location.origin + ' is in the widget\'s allowed websites.',
        )
      })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
