import json
import re
import sys
import urllib.request
import urllib.error


def scrape_check24_product(url: str) -> dict:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "de-DE,de;q=0.9",
    }

    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise ValueError(f"HTTP error while fetching page: {e.code}") from e
    except urllib.error.URLError as e:
        raise ValueError(f"Network error while fetching page: {e.reason}") from e

    # The product data is embedded as JSON inside a <script> tag
    match = re.search(
        r'data-ssr-key="desktop_check24de_ProductDetailPage"[^>]*><!--({.+?})-->',
        html,
        re.DOTALL,
    )
    if not match:
        raise ValueError("Could not find embedded product JSON in the page.")

    data = json.loads(match.group(1))

    product = data["productDetail"]["product"]
    title = product.get("name", "N/A")
    description = product.get("description", "N/A")

    return {"title": title, "description": description}


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://moebel.check24.de/product/A03A5093F22358"

    result = scrape_check24_product(url)

    print(f"Title:       {result['title']}")
    print(f"Description:\n{result['description']}")
