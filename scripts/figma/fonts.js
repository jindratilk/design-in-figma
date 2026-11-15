// Which fonts does this Figma tab have, and which text layers lost their font?
// args: { family?: 'Satoshi' }
const available = await figma.listAvailableFontsAsync();
const out = {};
if (args.family) out.styles = available.filter((f) => f.fontName.family === args.family).map((f) => f.fontName.style);
const missing = {};
for (const t of figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })) {
  if (!t.hasMissingFont) continue;
  for (const seg of t.getStyledTextSegments(['fontName'])) { const k = `${seg.fontName.family} ${seg.fontName.style}`; missing[k] = (missing[k] || 0) + 1; }
}
out.page = figma.currentPage.name;
out.missingOnPage = missing;
return out;
