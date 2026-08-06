// U+2800 (braille blank) renders as nothing but isn't whitespace, so it doesn't get trimmed like a
// space would. A long run of it in a footer forces that embed to Discord's max render width — use it
// to make a set of embeds (with or without their own image) render at a consistent, maximum width.
const WIDTH_PAD = '⠀'.repeat(120);

module.exports = { WIDTH_PAD };
