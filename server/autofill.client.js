(function () {
  var B64 = '__PAYLOAD__';
  var ACCENT = '#6ee7b7';

  function decode(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  var data;
  try {
    data = decode(B64);
  } catch (e) {
    alert('RoleAtelier: the autofill payload could not be read. Re-drag the button from the Autofill page.');
    return;
  }

  var p = data.profile || {};
  var answers = data.answers || [];
  var full = (p.fullName || '').trim();
  var parts = full.split(/\s+/).filter(Boolean);
  var first = p.firstName || parts[0] || '';
  var last = p.lastName || (parts.length > 1 ? parts.slice(1).join(' ') : '');
  var city = (p.location || '').split(',')[0].trim();

  function norm(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[\u2019']/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function haystack(el) {
    var bits = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('autocomplete'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-automation-id'),
      el.title,
    ];
    try {
      if (el.labels) for (var i = 0; i < el.labels.length; i++) bits.push(el.labels[i].innerText);
    } catch (e) {}
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      lb.split(/\s+/).forEach(function (id) {
        var n = document.getElementById(id);
        if (n) bits.push(n.innerText);
      });
    }
    var fieldset = el.closest ? el.closest('fieldset') : null;
    if (fieldset) {
      var legend = fieldset.querySelector('legend');
      if (legend) bits.push(legend.innerText);
    }
    var parent = el.parentElement;
    for (var d = 0; parent && d < 3; d++) {
      var direct = '';
      for (var k = 0; k < parent.childNodes.length; k++) {
        var node = parent.childNodes[k];
        if (node.nodeType === 3) direct += node.textContent;
      }
      if (direct.trim().length > 1 && direct.trim().length < 90) bits.push(direct);
      if (parent.tagName === 'FORM' || parent.tagName === 'BODY') break;
      parent = parent.parentElement;
    }
    return norm(bits.filter(Boolean).join(' '));
  }

  var FULL_NAME = /\b(full name|your name|applicant name|legal name|name of applicant)\b/;
  var FIRST_NAME = /\b(first name|given name|fname|forename|firstname)\b/;
  var LAST_NAME = /\b(last name|family name|surname|lname|lastname)\b/;
  var EMAIL = /\b(e mail|email|email address|mail)\b/;
  var PHONE = /\b(phone|telephone|mobile|cell|contact number|phone number)\b/;
  var LINKEDIN = /\b(linkedin|linked in)\b/;
  var GITHUB = /\b(github|git hub)\b/;
  var WEBSITE = /\b(website|portfolio|personal site|personal website|homepage|blog)\b/;
  var LOCATION = /\b(location|current location|where are you based|where do you live|city|town|address)\b/;
  var SALARY = /\b(salary|compensation|pay expectation|expected pay|desired salary|desired compensation|rate expectation)\b/;
  var YEARS = /\b(years of experience|years experience|how many years)\b/;
  var COVER = /\b(cover letter|coverletter|letter of interest|message to hiring)\b/;
  var SUMMARY = /\b(tell us about yourself|about you|professional summary|short bio|introduce yourself)\b/;
  var AUTHORIZED = /\b(authori[sz]ed to work|legally authori[sz]ed|eligible to work|right to work|work authori[sz]ation)\b/;
  var SPONSOR = /\b(require sponsorship|need sponsorship|visa sponsorship|require a visa|immigration sponsorship)\b/;

  var rules = [
    { re: FIRST_NAME, value: first },
    { re: LAST_NAME, value: last },
    { re: FULL_NAME, value: full },
    { re: EMAIL, value: p.email },
    { re: PHONE, value: p.phone },
    { re: LINKEDIN, value: p.linkedin },
    { re: GITHUB, value: p.github },
    { re: WEBSITE, value: p.website },
    { re: SALARY, value: p.salary },
    { re: YEARS, value: p.years },
    { re: LOCATION, value: city || p.location },
    { re: AUTHORIZED, value: p.authorized },
    { re: SPONSOR, value: p.sponsor },
    { re: COVER, value: data.coverLetter },
    { re: SUMMARY, value: p.summary },
  ];

  function autocompleteHint(el) {
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac === 'given-name') return first;
    if (ac === 'family-name') return last;
    if (ac === 'name') return full;
    if (ac === 'email') return p.email;
    if (ac === 'tel' || ac === 'tel-national') return p.phone;
    if (ac === 'url') return p.website;
    if (ac === 'address-level2') return city;
    return '';
  }

  function isFilled(el) {
    if (el.tagName === 'SELECT') {
      var t = norm(el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '');
      return el.value !== '' && !/^(select|choose|please select|select one|select an option|none)$/.test(t);
    }
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    if (el.isContentEditable) return (el.innerText || '').trim().length > 0;
    return (el.value || '').trim().length > 0;
  }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setValue(el, value) {
    if (value == null || value === '') return false;
    var v = String(value).trim();
    if (!v) return false;
    var tag = el.tagName;

    if (tag === 'SELECT') {
      var opts = Array.prototype.slice.call(el.options);
      var lv = norm(v);
      var pick =
        opts.find(function (o) { return norm(o.value) === lv || norm(o.text) === lv; }) ||
        opts.find(function (o) { return norm(o.text).indexOf(lv) !== -1 || lv.indexOf(norm(o.text)) !== -1; });
      if (!pick && /^(yes|no|true|false)$/i.test(v)) {
        var wantYes = /^(yes|true)$/i.test(v);
        pick = opts.find(function (o) {
          var t = norm(o.text);
          return wantYes ? /^(yes|y|true)/.test(t) : /^(no|n|false)/.test(t);
        });
      }
      if (!pick) return false;
      el.value = pick.value;
      fire(el);
      return true;
    }

    if (el.type === 'checkbox' || el.type === 'radio') {
      var desired = /^(yes|true|authorized|1|on)$/i.test(v);
      if (el.type === 'radio') {
        if (desired && !el.checked) el.click();
        return desired;
      }
      if (el.checked !== desired) el.click();
      return true;
    }

    if (el.isContentEditable) {
      el.focus();
      el.textContent = v;
      fire(el);
      return true;
    }

    var proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v);
    else el.value = v;
    fire(el);
    el.dispatchEvent(new Event('keyup', { bubbles: true }));
    return true;
  }

  function matchesQuestion(text, question) {
    var qWords = norm(question).split(' ').filter(function (w) { return w.length > 3; });
    if (!qWords.length) return false;
    var hit = 0;
    for (var i = 0; i < qWords.length; i++) if (text.indexOf(qWords[i]) !== -1) hit++;
    return hit / qWords.length >= 0.7;
  }

  var fields = Array.prototype.slice.call(
    document.querySelectorAll('input, textarea, select, [contenteditable="true"]'),
  ).filter(function (el) {
    if (!el.offsetParent && el.type !== 'hidden' && el.tagName !== 'SELECT') return false;
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === 'INPUT') {
      var t = (el.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password', 'range', 'color'].indexOf(t) !== -1) return false;
      if (el.getAttribute('role') === 'combobox') return false;
    }
    return true;
  });

  var filled = 0;
  var skippedFilled = 0;
  var files = 0;

  fields.forEach(function (el) {
    if (el.type === 'file') { files++; return; }
    if (isFilled(el)) { skippedFilled++; return; }
    var text = haystack(el);
    var value = '';

    var hint = autocompleteHint(el);
    if (hint) value = hint;

    if (!value) {
      for (var i = 0; i < rules.length; i++) {
        if (rules[i].re.test(text) && rules[i].value) { value = rules[i].value; break; }
      }
    }

    if (!value) {
      for (var j = 0; j < answers.length; j++) {
        if (matchesQuestion(text, answers[j].question) && answers[j].answer) { value = answers[j].answer; break; }
      }
    }

    if (value && setValue(el, value)) filled++;
  });

  var existing = document.getElementById('__roleatelier_toast__');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = '__roleatelier_toast__';
  toast.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'right:18px', 'bottom:18px', 'max-width:340px',
    'background:#101318', 'color:#e7ecf3', 'border:1px solid rgba(110,231,183,.35)',
    'border-radius:14px', 'padding:14px 16px',
    'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
    'box-shadow:0 18px 50px rgba(0,0,0,.45)', 'letter-spacing:.1px',
  ].join(';');
  toast.innerHTML =
    '<div style="font-weight:650;color:' + ACCENT + ';margin-bottom:4px">RoleAtelier filled ' + filled + ' field' + (filled === 1 ? '' : 's') + '</div>' +
    (skippedFilled ? '<div style="opacity:.65;font-size:12px">' + skippedFilled + ' already had a value — left alone.</div>' : '') +
    (files ? '<div style="opacity:.65;font-size:12px;margin-top:4px">Attach your resume manually (' + files + ' upload field' + (files === 1 ? '' : 's') + ').</div>' : '') +
    '<div style="opacity:.45;font-size:11px;margin-top:8px">Review every answer before submitting.</div>';
  document.body.appendChild(toast);
  setTimeout(function () { if (toast.parentNode) toast.remove(); }, 9000);
})();
