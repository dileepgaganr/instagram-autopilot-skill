const TELLS = [
  /\bdelv(e|es|ing)\b/i, /\bdive into\b/i, /\bgame[- ]changer\b/i, /\bunlock(s|ing)?\b/i, /\bunleash/i, /\belevate(s|d)?\b/i,
  /\bseamless(ly)?\b/i, /\bleverag(e|es|ing)\b/i, /\btestament\b/i, /\bin today's (video|world)\b/i, /\bstop scrolling\b/i,
  /\bfollow for more\b/i, /\btag someone who\b/i, /\bthe algorithm loves\b/i, /\brun,? don't walk\b/i, /\b(thrilled|excited) to (announce|share)\b/i,
  /\bnot just\b[^.]{0,40}\bit's\b/i,
];
const INVISIBLE = /[​-‍⁠﻿­᠎⁡-⁤\u{E0000}-\u{E007F}]/gu;

/** Strips characters nobody can see but that survive copy-paste from generated text. */
export function clean(text) {
  return text.replace(INVISIBLE, '').replace(/[ \t]+\n/g, '\n').trim();
}

/** What the feed shows before "… more": the first `fold` characters, cut where Instagram cuts. */
export function fold(text, chars = 125) {
  const first = text.split('\n')[0];
  return [...first].length > chars ? `${[...first].slice(0, chars).join('')}…` : first;
}

export function lintCaption(raw, rules) {
  const text = clean(raw);
  const errors = [];
  const warnings = [];
  const len = [...text].length;
  if (!len) errors.push('caption is empty');
  if (len > 2200) errors.push(`${len} characters (max 2200)`);
  const tags = text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length > rules.max_hashtags) errors.push(`${tags.length} hashtags (max ${rules.max_hashtags})`);
  if (raw.replace(INVISIBLE, '') !== raw) warnings.push('had invisible characters (removed)');
  for (const phrase of rules.require_phrases ?? []) if (!new RegExp(phrase, 'i').test(text)) errors.push(`missing required phrase /${phrase}/`);
  for (const phrase of rules.banned_phrases ?? []) if (new RegExp(phrase, 'i').test(text)) errors.push(`contains banned phrase /${phrase}/`);
  const first = text.split('\n')[0];
  if ([...first].length > rules.fold_chars) warnings.push(`first line is ${[...first].length} chars, so the feed cuts it mid-thought at ${rules.fold_chars}`);
  if (/^(hey|hi|hello)\b/i.test(first)) warnings.push('opens with a greeting');
  for (const re of TELLS) if (re.test(text)) warnings.push(`stock phrase: ${re.source.replace(/\\b/g, '')}`);
  if ((text.match(/—/g) ?? []).length > 2) warnings.push('more than 2 em dashes');
  if (/https?:\/\//.test(text)) warnings.push('links in captions are not clickable; point to the bio');
  return { text, errors, warnings, fold: fold(text, rules.fold_chars), features: { caption_chars: len, hashtags: tags.length, first_line_chars: [...first].length, has_question: /\?/.test(first) } };
}
