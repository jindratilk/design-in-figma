// How wide does Figma set a text? Use it to check that the font your mockup loads is the
// same cut Figma has: compare with getBoundingClientRect().width of the same text in the
// browser. A difference of more than half a pixel per 100 px means another font version,
// and wrapped lines, gaps and auto layout will not match.
// args: { texts: [['Order 20418', 26, 'Bold'], ...], family? = 'Inter' }   [text, size in px, style]
const family = args.family || 'Inter';
const t = figma.createText();
const out = [];
try {
  for (const [chars, size, style = 'Regular'] of args.texts || []) {
    await figma.loadFontAsync({ family, style });
    t.fontName = { family, style }; t.textAutoResize = 'WIDTH_AND_HEIGHT'; t.characters = chars;
    t.fontSize = size * 10; // Figma rounds a text box up to whole pixels: measure at 10x
    out.push({ text: chars, size, style, width: Math.round(t.width * 10) / 100 });
  }
} finally { t.remove(); }
return out;
