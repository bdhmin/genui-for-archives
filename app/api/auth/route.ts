import { NextRequest, NextResponse } from 'next/server';

const SITE_PASSWORD = process.env.SITE_PASSWORD;
const COOKIE_NAME = 'site_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Simple hash function for the auth token
function generateAuthToken(): string {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2);
  return Buffer.from(`${timestamp}:${random}`).toString('base64');
}

// POST: Verify password and set auth cookie
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    if (!SITE_PASSWORD) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    if (password === SITE_PASSWORD) {
      const token = generateAuthToken();
      const response = NextResponse.json({ success: true });
      
      response.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
      });

      return response;
    }

    return NextResponse.json(
      { error: 'Invalid password' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}

// GET: Check if authenticated
export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get(COOKIE_NAME);
  
  if (authCookie?.value) {
    return NextResponse.json({ authenticated: true });
  }
  
  return NextResponse.json({ authenticated: false }, { status: 401 });
}

// DELETE: Logout (clear cookie)
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  return response;
}

