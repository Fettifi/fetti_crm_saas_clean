import { Octokit } from 'octokit';

// Initialize Octokit
// Requires GITHUB_TOKEN in .env
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

const OWNER = process.env.REPO_OWNER || 'fetti-crm'; // Default or Env
const REPO = process.env.REPO_NAME || 'azure-plasma'; // Default or Env

export async function readCode(path: string) {
    try {
        const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner: OWNER,
            repo: REPO,
            path: path,
        });

        if (Array.isArray(response.data)) {
            return "Directory listing not supported yet. Please specify a file.";
        }

        if ('content' in response.data) {
            return Buffer.from(response.data.content, 'base64').toString('utf-8');
        }

        return "File content not found.";
    } catch (error: any) {
        console.error('GitHub Read Error:', error);
        return `Error reading file: ${error.message}`;
    }
}

export async function proposeUpgrade(path: string, content: string, message: string) {
    try {
        // 1. Get current main SHA
        const mainRef = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
            owner: OWNER,
            repo: REPO,
            ref: 'heads/main',
        });
        const mainSha = mainRef.data.object.sha;

        // 2. Create new branch
        const branchName = `rupee/upgrade-${Date.now()}`;
        await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
            owner: OWNER,
            repo: REPO,
            ref: `refs/heads/${branchName}`,
            sha: mainSha,
        });

        // 3. Get current file SHA (if it exists) to update it
        let fileSha;
        try {
            const fileRef = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
                owner: OWNER,
                repo: REPO,
                path: path,
                ref: branchName
            });
            if (!Array.isArray(fileRef.data)) {
                fileSha = fileRef.data.sha;
            }
        } catch (e) {
            // File might be new
        }

        // 4. Create Commit (Update File)
        await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
            owner: OWNER,
            repo: REPO,
            path: path,
            message: message,
            content: Buffer.from(content).toString('base64'),
            branch: branchName,
            sha: fileSha
        });

        // 5. Open Pull Request
        const pr = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
            owner: OWNER,
            repo: REPO,
            title: `Rupee Upgrade: ${message}`,
            body: `Automated upgrade proposed by Rupee.\n\nTask: ${message}`,
            head: branchName,
            base: 'main'
        });

        return {
            success: true,
            branch: branchName,
            prNumber: pr.data.number,
            url: pr.data.html_url
        };

    } catch (error: any) {
        console.error('GitHub Upgrade Error:', error);
        return { success: false, error: error.message };
    }
}

export async function deployUpgrade(prNumber: number) {
    try {
        // 1. Get PR details to find Head SHA
        const pr = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
            owner: OWNER,
            repo: REPO,
            pull_number: prNumber,
        });
        const headSha = pr.data.head.sha;

        // 2. Check CI Status (GitHub Actions)
        // We poll for a few seconds to see if it's already failed or if it's pending.
        // In a real agent scenario, we might return "Build Pending" and ask user to try again later.
        // For this implementation, we will check once.

        const checks = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
            owner: OWNER,
            repo: REPO,
            ref: headSha,
        });

        const failedChecks = checks.data.check_runs.filter(run => run.conclusion === 'failure');
        const pendingChecks = checks.data.check_runs.filter(run => run.status === 'in_progress' || run.status === 'queued');

        if (failedChecks.length > 0) {
            return {
                success: false,
                error: `Safety Protocol Engaged: Build failed. I cannot deploy broken code. (Check ID: ${failedChecks[0].id})`
            };
        }

        if (pendingChecks.length > 0) {
            return {
                success: false,
                error: "Safety Protocol Engaged: Build is still verifying. Please wait 30 seconds and try 'deploySystem' again."
            };
        }

        // 3. Merge PR if safe
        const merge = await octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
            owner: OWNER,
            repo: REPO,
            pull_number: prNumber,
            commit_title: `Rupee Deploy: PR #${prNumber}`,
            merge_method: 'squash'
        });

        return {
            success: true,
            message: merge.data.message,
            sha: merge.data.sha
        };
    } catch (error: any) {
        console.error('GitHub Deploy Error:', error);
        return { success: false, error: error.message };
    }
}
