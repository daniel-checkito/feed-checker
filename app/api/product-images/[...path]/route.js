const fs = require("fs");
const path = require("path");

const BASE_DIR_NAME = "product_images";

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function sanitizeRequestedRelPath(requested) {
  // Accept:
  // - "<filename>"
  // - "image_1.jpg"
  // - "subfolder/image.jpg"
  // - "product_images/image.jpg" (will be stripped)
  // Reject anything that tries path traversal.
  let rel = String(requested || "").trim();
  if (!rel) return null;

  rel = rel.replace(/^\/+/, "");
  rel = rel.replace(/^product_images\//, "");

  // Quick traversal rejection.
  if (rel.includes("..")) return null;
  if (rel.includes("\0")) return null;

  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return null;
  if (parts.some((p) => p === ".." || p === ".")) return null;

  return parts.join("/");
}

export async function GET(req, { params }) {
  try {
    const segments = params?.path;
    const requested = Array.isArray(segments) ? segments.join("/") : segments;

    const relPath = sanitizeRequestedRelPath(requested);
    if (!relPath) return Response.json({ error: "Invalid path" }, { status: 400 });

    const baseDir = path.resolve(process.cwd(), BASE_DIR_NAME);
    const absPath = path.resolve(baseDir, relPath);

    // Ensure absPath stays inside baseDir (real path checks are expensive).
    if (!absPath.startsWith(`${baseDir}${path.sep}`) && absPath !== baseDir) {
      return Response.json({ error: "Invalid path" }, { status: 400 });
    }

    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return Response.json({ error: "Not found" }, { status: 404 });

    const contentType = getMimeType(absPath);
    const stream = fs.createReadStream(absPath);

    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        // Long cache because images are static locally.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

