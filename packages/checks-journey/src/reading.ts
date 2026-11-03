// The quote rule a model's reading is held to (#37, design: Reading by reference): a quote is in the screen it read
// when, after Unicode NFC and each whitespace run collapsed to one space, it is a byte-exact substring of the text
// snapshot. A false reading whose quote isn't there is dropped and counted; one whose quote is there can send the
// claim back; a true reading never passes anything.
const normal = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim();
export const quoteIn = (quote: string, text: string): boolean => quote.length > 0 && normal(text).includes(normal(quote));
