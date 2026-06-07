import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
    // Apex domain (fettifi.com / www) serves the public marketing homepage;
    // the CRM lives on app.fettifi.com. Rewrite the apex root to /home.
    const host = (request.headers.get('host') || '').toLowerCase();
    const isApex = host === 'fettifi.com' || host === 'www.fettifi.com';
    if (isApex && request.nextUrl.pathname === '/') {
        const url = request.nextUrl.clone();
        url.pathname = '/home';
        return NextResponse.rewrite(url);
    }

    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    let supabase;
    try {
        supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return request.cookies.get(name)?.value
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        request.cookies.set({
                            name,
                            value,
                            ...options,
                        })
                        response = NextResponse.next({
                            request: {
                                headers: request.headers,
                            },
                        })
                        response.cookies.set({
                            name,
                            value,
                            ...options,
                        })
                    },
                    remove(name: string, options: CookieOptions) {
                        request.cookies.set({
                            name,
                            value: '',
                            ...options,
                        })
                        response = NextResponse.next({
                            request: {
                                headers: request.headers,
                            },
                        })
                        response.cookies.set({
                            name,
                            value: '',
                            ...options,
                        })
                    },
                },
            }
        )
    } catch (e) {
        console.error("Proxy Supabase Init Failed:", e);
        // If Supabase fails, allow request but session will be null
        return response;
    }

    let session = null;
    if (supabase) {
        try {
            const { data } = await supabase.auth.getSession();
            session = data.session;
        } catch (e) {
            console.error("Proxy Session Check Failed:", e);
        }
    }

    const protectedRoutes = ['/leads', '/pipeline', '/settings', '/training', '/team']
    const isProtectedRoute = protectedRoutes.some(route => request.nextUrl.pathname.startsWith(route))

    // If accessing protected route without session, redirect to login
    if (isProtectedRoute && !session) {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/login'
        redirectUrl.searchParams.set('redirectedFrom', request.nextUrl.pathname)
        return NextResponse.redirect(redirectUrl)
    }

    // If accessing login page with session, redirect to leads
    if (request.nextUrl.pathname === '/login' && session) {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/leads'
        return NextResponse.redirect(redirectUrl)
    }

    return response
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - api (API routes - keep open for now or protect selectively)
         * - portal (Client Portal - has its own auth logic)
         */
        '/((?!_next/static|_next/image|favicon.ico|api|portal).*)',
    ],
}
