# The canvas working order

Work on a canvas document in this order, and judge by numbers, never by eye.

1. Start from a piece recipe, or from a kind deep_kinds lists. A document that holds one piece recipe and its parameters is where a piece starts; deep_kinds lists the recipes first, each with one example.
2. Check the document before any render. deep_show answers with the document's issues; fix every error first.
3. Render small, and read the issues the render-back gives.
4. Fix by patch: break out the one item to change and set it, and leave the rest to its recipe.
5. Render in full last, once the numbers pass.

When no kind or field does what the piece needs, record an open item with deep_open_item naming the missing kind or field. Never approximate it with other kinds.

Every example in the gallery is pinned by its hash, read and never run. What this core can do is what its own listing, guides and gallery say, not memory or a newer release's docs.
