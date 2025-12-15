import { spawn } from 'child_process';

async function testChat() {
    console.log('Testing Chat API...');

    const response = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mode: 'co-founder',
            history: [{ role: 'user', content: 'Hello' }],
            message: 'Hello, are you there?'
        })
    });

    if (!response.ok) {
        console.error(`API Error: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.error('Response:', text);
        return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
        console.error('No response body reader available');
        return;
    }

    console.log('Stream started...');

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        console.log('Received chunk:', chunk);
    }

    console.log('Stream finished.');
}

testChat().catch(console.error);
