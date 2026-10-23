import { NextResponse, type NextRequest } from "next/server";

// The bakery's own domain shows only the public site, at its root; the ERP stays
// on the vercel.app address and is not reachable from here (/login on the public
// domain is simply «не найдено»).
const PUBLIC_SITE_HOSTS = new Set(["ar-amir.com", "www.ar-amir.com"]);
const SITE_ROOT = "/ar-amir";

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!PUBLIC_SITE_HOSTS.has(host)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // Verification files at the root (Meta's «Upload an HTML file») are served as they are.
  if (/^\/[a-z0-9]+\.html$/.test(pathname)) return NextResponse.next();
  // Links inside the site point at /ar-amir…; on the domain the clean path is used.
  if (pathname === SITE_ROOT || pathname.startsWith(`${SITE_ROOT}/`)) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice(SITE_ROOT.length) || "/";
    return NextResponse.redirect(url, 308);
  }
  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? SITE_ROOT : `${SITE_ROOT}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Static files and images pass straight through.
  matcher: ["/((?!_next/|site/|fonts/|favicon|icon|apple-icon|manifest|robots|sitemap).*)"],
};
