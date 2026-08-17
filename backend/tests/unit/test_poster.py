"""Unit tests for lecture poster rendering.

Posters exist to keep the console hero off the source PDF. The hero previously
handed pdf_url to react-pdf, which auto-fetches the whole document, so painting a
background cost 1.6-6.9 MB per focused lecture and dominated the Supabase egress
overage. These tests guard the two properties that make a poster a fix rather
than a rename: it must be a real image, and it must be dramatically smaller than
the PDF it came from.
"""
from __future__ import annotations

import pytest

from backend.services.parser.poster import (
    POSTER_CACHE_CONTROL,
    poster_path,
    render_poster,
)


def test_render_poster_returns_webp(sample_pdf_bytes: bytes):
    webp = render_poster(sample_pdf_bytes)
    assert webp, "a 3-page PDF must produce a poster"
    # WebP container: 'RIFF' <4-byte size> 'WEBP'
    assert webp[:4] == b"RIFF"
    assert webp[8:12] == b"WEBP"


def _image_heavy_pdf(pages: int = 6) -> bytes:
    """A PDF whose weight comes from embedded raster images.

    This is what real lecture decks look like, and it is why posters win. A
    text-only PDF is *more* compact as vectors than any rasterisation of it, so
    rendering one can legitimately produce a larger file -- the reduction comes
    from image-heavy decks, which is the actual corpus (measured: 6.88 MB deck ->
    124 KB poster).
    """
    import fitz
    from PIL import Image
    import io

    # Deterministic non-uniform pixels: a flat colour would compress to nothing
    # and understate a real slide's weight.
    img = Image.new("RGB", (1400, 800))
    img.putdata([((x * 7) % 256, (y * 11) % 256, (x * y) % 256)
                 for y in range(800) for x in range(1400)])
    png = io.BytesIO()
    img.save(png, format="PNG")
    png_bytes = png.getvalue()

    doc = fitz.open()
    for _ in range(pages):
        page = doc.new_page(width=1400, height=800)
        page.insert_image(fitz.Rect(0, 0, 1400, 800), stream=png_bytes)
    out = doc.tobytes()
    doc.close()
    return out


def test_render_poster_shrinks_an_image_heavy_deck():
    """The whole point is byte reduction on real decks, so assert it."""
    pdf_bytes = _image_heavy_pdf()
    webp = render_poster(pdf_bytes)
    assert webp
    assert len(webp) < len(pdf_bytes) / 2, (
        f"poster ({len(webp) / 1024:.0f} KB) must be a large reduction on a "
        f"{len(pdf_bytes) / 1024:.0f} KB image-heavy deck"
    )


def test_render_poster_output_size_is_bounded_regardless_of_input():
    """The invariant that actually protects egress: poster size is driven by
    POSTER_WIDTH, not by how heavy the source PDF is. A 7 MB deck and a 60 KB
    deck both produce roughly the same small image."""
    small = render_poster(_image_heavy_pdf(pages=1))
    large = render_poster(_image_heavy_pdf(pages=40))
    assert small and large
    assert len(large) < 400 * 1024, f"poster grew to {len(large) / 1024:.0f} KB"
    # Page 1 is identical in both, so the renders should be too -- page count
    # must not leak into poster size.
    assert len(small) == len(large)


def test_render_poster_width_is_respected():
    import fitz
    from PIL import Image
    import io

    doc = fitz.open()
    doc.new_page(width=800, height=600)
    pdf_bytes = doc.tobytes()
    doc.close()

    webp = render_poster(pdf_bytes, width=640)
    assert webp
    assert Image.open(io.BytesIO(webp)).width == 640


@pytest.mark.parametrize(
    "bad",
    [b"", b"not a pdf at all", b"%PDF-1.4 truncated garbage"],
    ids=["empty", "not-pdf", "truncated"],
)
def test_render_poster_never_raises_on_bad_input(bad: bytes):
    """Key art is decorative -- a bad PDF must degrade to no poster, never fail
    the parse it is running inside."""
    assert render_poster(bad) is None


# NOTE: the `page_count == 0` guard in render_poster is deliberately untested --
# PyMuPDF refuses to serialise a zero-page document ("cannot save with zero
# pages"), so such bytes cannot be constructed here. The guard stays as defence
# against PDFs that parse but expose no pages; the malformed-input cases above
# cover the degradation path.


def test_poster_path_puts_lecture_id_in_segment_two():
    """The lecture-posters RLS policies derive ownership from
    (string_to_array(name,'/'))[2]::uuid -- if this path shape changes, those
    policies silently stop matching."""
    lecture_id = "1f7113e4-de82-4095-9538-6fc0871aa56e"
    path = poster_path(lecture_id)
    assert path.split("/")[1] == lecture_id
    assert path == f"lectures/{lecture_id}/poster.webp"


def test_poster_cache_control_is_long_lived():
    """A short cacheControl sends repeat viewers back to origin and re-creates
    the egress problem posters were introduced to solve."""
    assert int(POSTER_CACHE_CONTROL) >= 30 * 24 * 3600
