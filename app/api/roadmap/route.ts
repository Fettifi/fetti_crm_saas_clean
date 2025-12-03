import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), 'roadmap.md');
        const content = fs.readFileSync(filePath, 'utf8');
        return NextResponse.json({ content });
    } catch (error) {
        return NextResponse.json({ content: "# Roadmap\n\n*Loading...*" });
    }
}
