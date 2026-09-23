import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Missing env on Vercel would otherwise throw MIDDLEWARE_INVOCATION_FAILED (500).
  if (!url || !anonKey) {
    const path = request.nextUrl.pathname;
    if (!path.startsWith("/login") && !path.startsWith("/api/health")) {
      const login = request.nextUrl.clone();
      login.pathname = "/login";
      return NextResponse.redirect(login);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;
    const isAuthPage = path.startsWith("/login");
    const isPublic = isAuthPage || path.startsWith("/api/health");

    if (!user && !isPublic) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      return NextResponse.redirect(redirectUrl);
    }

    if (user && isAuthPage) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/orders/new";
      return NextResponse.redirect(redirectUrl);
    }
  } catch {
    // Auth check failed (network / edge) — still serve the page rather than 500.
    return NextResponse.next({ request });
  }

  return supabaseResponse;
}
