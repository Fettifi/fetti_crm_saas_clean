
// Verify API Script
// Run with: npx tsx scripts/verify-api.ts

import { POST } from '../app/api/chat/route';
import { NextRequest } from 'next/server';

// Mock NextRequest
class MockRequest extends Request {
    json() {
        return Promise.resolve({
            mode: 'co-founder',
            history: [{ role: 'user', content: 'Hello Rupee' }],
            message: 'Hello Rupee'
        });
    }
}

async function main() {
    console.log("Simulating Chat API Request...");

    try {
        const req = new MockRequest('http://localhost:3000/api/chat', {
            method: 'POST',
        }) as unknown as NextRequest;

        const response = await POST(req);
        const data = await response.json();

        console.log("Response Status:", response.status);
        console.log("Response Data:", data);

        if (response.status === 200) {
            console.log("✅ API Request Successful");
        } else {
            console.error("❌ API Request Failed");
        }

    } catch (error) {
        console.error("❌ API Request Crashed:", error);
    }
}

main();
