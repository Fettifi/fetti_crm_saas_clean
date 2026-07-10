import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
    // Apex domain (fettifi.com / www) serves the public marketing homepage;
    // the CRM lives on app.fettifi.com. Rewrite the apex root to /home.
    const host = (request.headers.get('host') || '').toLowerCase();
    // Canonical host is the bare apex (fettifi.com). Permanently redirect www ->
    // apex so SEO authority consolidates on one domain (no duplicate content).
    if (host === 'www.fettifi.com') {
        return NextResponse.redirect(`https://fettifi.com${request.nextUrl.pathname}${request.nextUrl.search}`, 308);
    }
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

    const path = request.nextUrl.pathname

    // Machine-to-machine endpoints authenticate by a bearer token inside the
    // route (not a login session), so they bypass the session gate below. The
    // route itself returns 401 if the token is missing/wrong, and 503 if no
    // token is configured (fail-closed).
    const tokenAuthedApis = ['/api/pricing/feed']
    if (tokenAuthedApis.includes(path)) return response

    // Sensitive internal DATA APIs — return 401 (not a redirect) when unauthed.
    // Public APIs (apply, file portal, wizard, cron, sms) are NOT listed and stay open.
    const apiProtected = ['/api/los', '/api/income', '/api/stats', '/api/tasks', '/api/players', '/api/bosses', '/api/growth/generate', '/api/content', '/api/doctor', '/api/preapprovals', '/api/tiktok/publish', '/api/tiktok/creator-info', '/api/chat', '/api/rupee', '/api/pricing', '/api/funnel', '/api/partners', '/api/agents', '/api/applications', '/api/tts', '/api/studio', '/api/settings', '/api/esign/requests', '/api/dashboard', '/api/pricer', '/api/referral', '/api/voice/messages', '/api/scenarios', '/api/wholesalers', '/api/conversations', '/api/compare', '/api/show', '/api/admin', '/api/shield/resolve', '/api/competitors']
    if (apiProtected.some(route => path.startsWith(route)) && !session) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    // Internal CRM pages — require login. Public marketing/borrower pages
    // (/home, /apply, /quote, /start, /lending, /file, /portal, /privacy, /terms) are NOT listed.
    const protectedRoutes = [
        '/leads', '/pipeline', '/settings', '/training', '/team',
        '/command', '/los', '/agents', '/partners', '/requests', '/automations', '/task-list', '/roadmap', '/dashboard', '/growth', '/content', '/doctor', '/preapprovals', '/rupee', '/pricing', '/funnel', '/ads', '/security', '/studio', '/esign', '/pricer', '/income', '/messages', '/scenarios', '/conversations', '/compare', '/show', '/competitors',
    ]
    const isProtectedRoute = protectedRoutes.some(route => path.startsWith(route))

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
        // Sensitive internal data APIs are protected explicitly (others stay open).
        '/api/los/:path*',
        '/api/stats/:path*',
        '/api/tasks/:path*',
        '/api/players/:path*',
        '/api/bosses/:path*',
        '/api/growth/generate/:path*',
        '/api/content/:path*',
        '/api/doctor/:path*',
        '/api/preapprovals/:path*',
        '/api/tiktok/publish/:path*',
        '/api/tiktok/publish-status/:path*',
        '/api/tiktok/creator-info/:path*',
        '/api/chat/:path*',
        '/api/rupee/:path*',
        '/api/pricing/:path*',
        '/api/funnel/:path*',
        '/api/partners/:path*',
        '/api/agents/:path*',
        '/api/applications/:path*',
        '/api/tts/:path*',
        '/api/studio/:path*',
        '/api/settings/:path*',
        '/api/esign/requests/:path*',
        '/api/dashboard/:path*',
        '/api/pricer/:path*',
        '/api/income/:path*',
        '/api/referral/:path*',
        '/api/voice/messages/:path*',
        '/api/scenarios/:path*',
        '/api/wholesalers/:path*',
        '/api/conversations/:path*',
        '/api/compare/:path*',
        '/api/show/:path*',
        '/api/admin/:path*',
        '/api/shield/resolve/:path*',
        '/api/competitors/:path*',
    ],
}
