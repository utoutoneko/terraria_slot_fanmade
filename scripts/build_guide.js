#!/usr/bin/env node
// Regenerates complete_guide.html (and secretguide_data.js) from guide_template.html,
// pulling the two large, error-prone data tables (all symbols' odds, all achievements'
// conditions) directly out of the real game source instead of a hand-typed copy.
//
// Why this exists: the guide used to contain a manually re-typed copy of 76 symbols and
// 100 achievements. Every time a theme's multipliers or the achievement list changed in
// game.js/audio_data.js, someone had to remember to also retype the guide - and it did
// drift out of sync more than once (see DEVLOG.md, 2026-09-28 entries). This script makes
// "run the build" the only step required to keep the guide in sync.
//
// Usage: node scripts/build_guide.js
//   Reads:  audio_data.js, game.js, guide_template.html
//   Writes: complete_guide.html, secretguide_data.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const write = (name, content) => fs.writeFileSync(path.join(ROOT, name), content);

// Pulls out `const NAME = <literal>;` by scanning for the first `[` or `{` after the
// marker and walking forward with a bracket-depth counter, so it works regardless of
// how large or deeply-nested the literal is (doesn't rely on knowing the line count).
function extractLiteral(source, constName, identifierStubs) {
  const marker = `const ${constName} = `;
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`could not find "${marker}" in source`);
  const start = idx + marker.length;
  const openChar = source[start];
  const closeChar = openChar === "[" ? "]" : openChar === "{" ? "}" : null;
  if (!closeChar) throw new Error(`expected [ or { right after "${marker}", got "${openChar}"`);
  let depth = 0, i = start;
  for (; i < source.length; i++) {
    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar) { depth--; if (depth === 0) { i++; break; } }
  }
  let literalText = source.slice(start, i);
  // THEME_DEFS references the symbol-array constants by identifier (symbols:MIMIC_SYMBOLS);
  // we only need unlockCost/scatterId from it here, so those identifiers are stubbed to null
  // rather than requiring this script to also stand up the real arrays as bound variables.
  for (const [name, stub] of Object.entries(identifierStubs || {})) {
    literalText = literalText.replace(new RegExp(`\\b${name}\\b`, "g"), stub);
  }
  // Safe to eval in isolation: these literals hold only primitive values and (for
  // SHOP_ITEMS-style entries elsewhere) unexecuted arrow functions, whose bodies are
  // never called here - only ja/en/weight/mult/tier/condJa-style fields are read.
  // eslint-disable-next-line no-eval
  return eval(`(${literalText})`);
}

function main() {
  const audioSrc = read("audio_data.js");
  const gameSrc = read("game.js");

  const THEME_DEFS = extractLiteral(audioSrc, "THEME_DEFS", {
    MIMIC_SYMBOLS: "null", SLIME_SYMBOLS: "null", ZOMBIE_SYMBOLS: "null", ZENITH_SYMBOLS: "null",
  });
  const symbolsByTheme = {
    mimic: extractLiteral(audioSrc, "MIMIC_SYMBOLS"),
    slime: extractLiteral(audioSrc, "SLIME_SYMBOLS"),
    zombie: extractLiteral(audioSrc, "ZOMBIE_SYMBOLS"),
    zenith: extractLiteral(audioSrc, "ZENITH_SYMBOLS"),
  };
  const ACHIEVEMENT_DEFS = extractLiteral(gameSrc, "ACHIEVEMENT_DEFS");

  // THEME_ODDS: same shape the guide's own script expects, with the scatter flag derived
  // from THEME_DEFS[theme].scatterId rather than hand-marked per symbol.
  const themeOdds = {};
  for (const key of Object.keys(symbolsByTheme)) {
    const scatterId = THEME_DEFS[key].scatterId;
    themeOdds[key] = symbolsByTheme[key].map((s) => {
      const row = { nameJa: s.nameJa, nameEn: s.nameEn, weight: s.weight, mult: s.mult, tier: s.tier };
      if (s.id === scatterId) row.scatter = true;
      return row;
    });
  }

  const achievements = ACHIEVEMENT_DEFS.map((d) => {
    const row = { ja: d.ja, en: d.en, cond: d.condJa };
    if (d.hidden) row.hidden = true;
    return row;
  });

  function jsLiteral(value, indent) {
    // JSON.stringify gives valid JS object/array literal syntax for plain data like this
    // (no functions, no undefined, no special keys), just with double-quoted keys instead
    // of the template's original unquoted style - harmless, still valid JS either way.
    return JSON.stringify(value, null, 2).replace(/\n/g, "\n" + " ".repeat(indent)).replace(/^ +/, "");
  }

  const template = read("guide_template.html");
  if (!template.includes("/*BUILD:THEME_ODDS*/") || !template.includes("/*BUILD:ACHIEVEMENTS*/")) {
    throw new Error("guide_template.html is missing the /*BUILD:...*/ placeholders");
  }
  const output = template
    .replace("/*BUILD:THEME_ODDS*/", `const THEME_ODDS = ${jsLiteral(themeOdds, 0)};`)
    .replace("/*BUILD:ACHIEVEMENTS*/", `const ACHIEVEMENTS = ${jsLiteral(achievements, 0)};`);

  write("complete_guide.html", output);
  console.log(`complete_guide.html written (${output.length} bytes) - ${symbolsByTheme.mimic.length + symbolsByTheme.slime.length + symbolsByTheme.zombie.length + symbolsByTheme.zenith.length} symbols, ${achievements.length} achievements`);

  const secretGuideJs = `const SECRET_GUIDE_HTML = ${JSON.stringify(output)};\n`;
  write("secretguide_data.js", secretGuideJs);
  console.log(`secretguide_data.js written (${secretGuideJs.length} bytes)`);
}

main();
