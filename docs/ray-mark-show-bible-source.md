# Ray & Mark Show — RAW SOURCE (verbatim from Ramon's build session 32a5709a)
# Captured 2026-06-30 so the creative canon can never be lost. Do not edit; this is the source of truth.



===== line 70 | user =====
<system-reminder>[Truncated: PARTIAL view — showing lines 1-298 of 552 total (39249 tokens, cap 25000). Call Read with offset=299 limit=298 for the next page, or Grep to find a specific section. Do NOT answer from this page alone if the answer may be further in the file.]</system-reminder>

1	{
2	  "summary": "Map the Fetti CRM content engine, Mark persona, social integrations, proof surfaces, data layer, and media gen before building",
3	  "agentCount": 6,
4	  "logs": [],
5	  "result": {
6	    "maps": [
7	      {
8	        "subsystem": "Fetti CRM Content/Posting Engine",
9	        "summary": "A daily auto-generation pipeline creates 6 social-media posts (3 Reel/TikTok scripts + 1 image post) in Mark's voice using OpenAI gpt-4o-mini. Posts queue in Supabase content_posts table; one auto-publishes daily to Meta (Facebook/Instagram) via Graph API, rest await manual approval. TikTok requires user-recorded video upload + direct-post API. Reel scripts are text-only; no native video generation.",
10	        "files": [
11	          {
12	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/cron/content/route.ts",
13	            "role": "Daily Vercel cron (16:00 UTC): generates batch, auto-publishes 1 post to Meta"
14	          },
15	          {
16	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/content/page.tsx",
17	            "role": "Content Studio UI: queue display, manual publish, TikTok video composer"
18	          },
19	          {
20	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/content/publish/route.ts",
21	            "role": "Approves + publishes single post to Meta/TikTok"
22	          },
23	          {
24	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/content/video/route.ts",
25	            "role": "Issues signed Supabase upload URL for TikTok video"
26	          },
27	          {
28	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/cron/ad-factory/route.ts",
29	            "role": "Daily cron (12:00 UTC): generates 6 ad concepts, stores in studio_ad_ideas setting"
30	          },
31	          {
32	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/content/route.ts",
33	            "role": "List/generate/update content queue"
34	          },
35	          {
36	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/tiktok/publish/route.ts",
37	            "role": "Uploads video to TikTok Content Posting API"
38	          },
39	          {
40	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/content.ts",
41	            "role": "generatePosts/Image: OpenAI gpt-4o-mini text, gpt-image-1 images, Mark badge composite"
42	          },
43	          {
44	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/publish.ts",
45	            "role": "Real Meta Graph API posting to Facebook Page + Instagram Business"
46	          },
47	          {
48	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/tiktok.ts",
49	            "role": "TikTok OAuth, token refresh, creator_info query, direct video publish"
50	          },
51	          {
52	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/brand.ts",
53	            "role": "Mark persona, Fetti brand brief injected into all prompts"
54	          },
55	          {
56	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/markPersona.ts",
57	            "role": "Mark character definition, voice ID, signoff"
58	          },
59	          {
60	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/adFactory.ts",
61	            "role": "generateAdConcepts/Storyboard: OpenAI gpt-4o-mini for ad ideation"
62	          },
63	          {
64	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/vercel.json",
65	            "role": "Cron schedule config: content at 16:00, ad-factory at 12:00 UTC daily"
66	          }
67	        ],
68	        "howItWorks": "GENERATION: Daily cron /api/cron/content calls generateBatch() which: (1) calls OpenAI gpt-4o-mini via OPENAI_API_KEY with BRAND_BRIEF + CONTENT_PERSONALITY + CEDI_PERSONA system prompts + Mark's voice persona injected; requests 6 posts (hook/script/caption/hashtags). (2) For the image post, calls OpenAI gpt-image-1 with one of 14 predefined IMAGE_CONCEPTS (real-estate photos, Mark illustrations), gets JPEG back, composites Mark badge (CEDI_BADGE_B64) bottom-right using sharp library, uploads to Supabase Storage /content bucket as /auto/{timestamp}.jpg (returns public URL). (3) Returns 4 rows for DB insert: 3 Reel rows (type=reel, image_url=null) + 1 image post (type=image, image_url=publicUrl). All rows stamped with status=queued, scheduled_for=today, source=auto, platform=all.\n\nSTORAGE: Rows inserted into Supabase table content_posts with columns: id (uuid), type (reel|image), hook, script, caption, hashtags, image_url (nullable), status (queued|posted|skipped), scheduled_for (ISO date), source (auto|manual), platform (all), created_at, updated_at. AI-generated image JPEG stored in Supabase Storage bucket named 'content' at path /auto/{timestamp}.jpg. AD FACTORY: generateAdConcepts() calls gpt-4o-mini with MARK_PERSONA + MARK_INFORMATIONAL + creative constraints, returns 6 AdConcept objects (product/headline/sub/cta/hooks/line/prompt), serialized to JSON and upserted into app_settings table as key=studio_ad_ideas. Same for storyboards (generateStoryboard).\n\nSCHEDULING: Vercel cron config in vercel.json: /api/cron/content scheduled 0 16 * * * (4 PM UTC daily). /api/cron/ad-factory scheduled 0 12 * * * (noon UTC daily). Vercel injects CRON_SECRET header; route validates and runs. POST /api/content from UI triggers generateBatch manually with 60s debounce (one-per-minute limit).\n\nPUBLISHING (REAL): (1) AUTO-PUBLISH: cron/content calls publishPost(pick) on 1 queued post daily (prefers image post). publishPost() in lib/publish.ts: (a) calls healMetaToken() to validate/refresh META_ACCESS_TOKEN from DB app_settings or env; (b) fetches META_PAGE_ID and META_IG_USER_ID from app_settings; (c) if post.type=image + igUser: calls igPublish() → POST to Graph API /v21.0/{igUserId}/media with image_url + caption (SOCIAL_DISCLOSURE auto-appended) → waits up to 30s for container status=FINISHED via polling → POST /media_publish with creation_id. (d) if pageId: calls fbPhoto() → POST to /v21.0/{pageId}/photos with image_url + caption OR fbText() → POST /feed with caption text if no image. Returns PublishResult{ connected, channels[{platform, ok, detail}] }. (2) MANUAL APPROVE: UI button 'Approve & Publish' calls POST /api/content/publish with id → same publishPost() flow. Both mark post status=posted on success OR !connected (draft-only). (3) TikTok REAL: Requires user OAuth (TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET in app_settings or env). UI video composer: user records video file → calls POST /api/content/video to get signed Supabase upload URL → browser PUT video directly to Supabase Storage /content bucket at /tiktok/{timestamp}.mp4 → calls POST /api/tiktok/publish with {videoUrl, caption} → lib/tiktok.ts tiktokPublishVideo() fetches video from Supabase, calls tiktok.com POST /v2/post/publish/video/init/ with title (caption+SOCIAL_DISCLOSURE), gets publish_id + upload_url, PUTs video chunks to TikTok upload_url, returns publish_id. Privacy level auto-selected: PUBLIC_TO_EVERYONE if app audited, else SELF_ONLY (private).",
69	        "integrationPoints": [
70	          "OPENAI_API_KEY: gpt-4o-mini (generatePosts text) + gpt-image-1 (image generation)",
71	          "Supabase table content_posts: queued posts + metadata",
72	          "Supabase Storage bucket 'content': AI-generated images (/auto/) + user TikTok videos (/tiktok/)",
73	          "app_settings table keys: META_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID, META_USER_TOKEN, META_APP_ID, META_APP_SECRET, TIKTOK_ACCESS_TOKEN, TIKTOK_REFRESH_TOKEN, TIKTOK_OPEN_ID, TIKTOK_TOKEN_EXPIRES, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, studio_ad_ideas",
74	          "Meta Graph API v21.0: /oauth/access_token (refresh), /{pageId} (fetch IG account), /{igUserId}/media (create container), /{igUserId}/media_publish (publish IG post), /{pageId}/photos (FB photo post), /{pageId}/feed (FB text post)",
75	          "TikTok Open API v2: /oauth/token, /post/publish/creator_info/query, /post/publish/video/init, video chunk upload via returned upload_url",
76	          "Vercel Cron: GET /api/cron/content (0 16 UTC), GET /api/cron/ad-factory (0 12 UTC)",
77	          "ENV vars: OPENAI_API_KEY, OPENAI_MODEL (default gpt-4o-mini), META_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, CRON_SECRET (bearer auth)"
78	        ],
79	        "gaps": [
80	          "NO Reel video generation: Reel scripts are text templates. Users must manually record + perform scripts. No synthesis, no auto-voiceover (Mark voice ID nPczCjzI2devNBz1zQrb exists but unused in content engine). No video editing/compositing.",
81	          "TikTok auto-publish NOT wired into cron: Only manual user upload → direct post works. No daily auto-TikTok flow.",
82	          "No 'owned pages' targeting: All posts publish to configured channels only (single Facebook page + single IG account). No multi-page/account support or scheduling to different owned pages.",
83	          "No schedule/publish queue: Posts queued for approval but no 'schedule for later' date/time. No PostScheduledAt column.",
84	          "No compliance audit/staging: Posts don't go through a compliance review step before publication. SOCIAL_DISCLOSURE auto-appended but no audit trail.",
85	          "Meta token heals on-schedule + pre-publish but TikTok token healing happens only on status check or publish attempt (no proactive health cron like Doctor). No dedicated TikTok token-refresh cron.",
86	          "No lead tracking from content posts: Published posts don't auto-create UTM links to track which post drove leads. Growth-content.ts defines LINKS but content.ts doesn't use them.",
87	          "No content performance metrics: No table/view of engagement (likes, comments, shares) post-publish. No feedback loop to optimize future content.",
88	          "Image generation not contextual to post: 14 IMAGE_CONCEPTS are random; same image concepts used for all posts. No dynamic prompts based on post topic.",
89	          "No draft/preview approval workflow: Posts go directly from generated→queued. No user preview before auto-publish.",
90	          "Ad Factory output not auto-published: Ad concepts generate but stay in studio_ad_ideas setting. No render pipeline (no Loom/video export from storyboards).",
91	          "No webhook to notify on auto-publish success: Activity logged but no email/SMS/Discord alert when daily auto-publish completes.",
92	          "TikTok app requires Meta audit to post PUBLIC; pending audit = SELF_ONLY (private). No fallback if app never approved."
93	        ],
94	        "codeSnippets": [
95	          "const MODEL = process.env.OPENAI_MODEL || \"gpt-4o-mini\"; // in lib/content.ts line 27",
96	          "const rows = await generateBatch(topic); await supabaseAdmin.from(\"content_posts\").insert(rows).select(\"*\"); // auto-queue",
97	          "const res = await publishPost(pick); if (res.connected && res.channels.some((c) => c.ok)) { await supabaseAdmin.from(\"content_posts\").update({ status: \"posted\" }).eq(\"id\", pick.id); } // auto-publish 1 daily",
98	          "export async function publishPost(post: Post): Promise<PublishResult> { const token = await cfg(\"META_ACCESS_TOKEN\"); const pageId = await cfg(\"META_PAGE_ID\"); let igUser = await cfg(\"META_IG_USER_ID\"); // read creds from DB-first, then env",
99	          "if (igUser && post.image_url) { const id = await igPublish(igUser, token, post.image_url, caption); channels.push({ platform: \"instagram\", ok: true, detail: `Posted (${id}).` }); } // REAL IG publish",
100	          "if (pageId) { const id = post.image_url ? await fbPhoto(pageId, token, post.image_url, caption) : await fbText(pageId, token, caption); channels.push({ platform: \"facebook\", ok: true, detail: `Posted (${id}).` }); } // REAL FB publish",
101	          "const { data, error } = await supabaseAdmin.storage.from(\"content\").upload(path, buf, { contentType: \"image/jpeg\", upsert: false }); // upload AI image to Supabase",
102	          "const publishId = await tiktokPublishVideo(videoUrl, String(caption || \"\")); // from /api/tiktok/publish, calls lib/tiktok.ts",
103	          "await setSetting(\"studio_ad_ideas\", JSON.stringify(concepts)); // ad-factory stores output in app_settings"
104	        ]
105	      },
106	      {
107	        "subsystem": "Mark Persona Voice &amp; Brand System",
108	        "summary": "Mark is Fetti's golden-owl spokesperson mascot with a canonical voice definition split across two files: the foundational MARK_PERSONA system prompt in lib/markPersona.ts (with constants for signoff, ElevenLabs voice ID nPczCjzI2devNBz1zQrb, and tone rules) and the more social-focused CEDI_PERSONA in lib/brand.ts. The persona is actively used by the Creative Studio (app/studio/page.tsx) to generate video ads via the adFactory (lib/adFactory.ts), which feeds MARK_PERSONA + MARK_INFORMATIONAL into GPT-4o-mini calls. The system enforces the sign-off \"Fetti Financial Services, we do money!\" globally via withMarkSignoff() helper, and rules out the underselling phrase \"find the money\" in favor of \"we've got the money\" / \"we fund it\".",
109	        "files": [
110	          {
111	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/markPersona.ts",
112	            "role": "Canonical Mark voice/persona definition - exports MARK_SIGNOFF, MARK_VOICE_ID, MARK_PERSONA, MARK_INFORMATIONAL, MARK_COMPANY_SIGNOFF, and withMarkSignoff() utility"
113	          },
114	          {
115	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/brand.ts",
116	            "role": "Company-wide brand rules + CEDI_PERSONA (alternative/social Mark voice variant); also defines BRAND_BRIEF and CONTENT_PERSONALITY"
117	          },
118	          {
119	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/adFactory.ts",
120	            "role": "Importer &amp; user of MARK_PERSONA + MARK_INFORMATIONAL; generates ad concepts &amp; storyboards via GPT-4o-mini with Mark's voice injected into system prompt"
121	          },
122	          {
123	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/studio/page.tsx",
124	            "role": "Importer of withMarkSignoff() &amp; MARK_VOICE_ID; renders Mark video ads with canvas + TTS voiceover in the Creative Studio"
125	          },
126	          {
127	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/tts/route.ts",
128	            "role": "Text-to-speech API endpoint that accepts voiceId param (e.g. MARK_VOICE_ID) and routes to ElevenLabs or OpenAI"
129	          },
130	          {
131	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/integrations/elevenlabs.ts",
132	            "role": "TTS provider integration; maps MARK_VOICE_ID (nPczCjzI2devNBz1zQrb) to ElevenLabs voice, with OpenAI fallback"
133	          },
134	          {
135	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/gemini.ts",
136	            "role": "Multi-brain model layer used by Rupee (agentic assistant); defaults to claude-opus-4-8 for tool-calling turns when ANTHROPIC_API_KEY set"
137	          },
138	          {
139	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/los/underwrite/route.ts",
140	            "role": "Example Anthropic API integration; shows raw fetch pattern &amp; model selection via process.env.ANTHROPIC_MODEL"
141	          }
142	        ],
143	        "howItWorks": "Mark's voice is a system prompt injected into LLM calls, primarily via the adFactory which uses MARK_PERSONA + MARK_INFORMATIONAL to shape GPT-4o-mini's output into video ad scripts. The flow is: (1) adFactory.generateAdConcepts() calls GPT-4o-mini with sys=`${MARK_PERSONA}\\n${MARK_INFORMATIONAL}\\n...` + user instruction to generate N ad concepts as JSON. (2) Each concept's voiceover line is passed through withMarkSignoff() to ensure it ends with exactly \\\"Fetti Financial Services, we do money!\\\" and scrubs any duplicate sign-offs. (3) The Creative Studio (app/studio/page.tsx) loads these concepts, lets admins edit them, then records a video: it calls /api/tts with the voiceover text + voiceId=MARK_VOICE_ID (nPczCjzI2devNBz1zQrb, a custom ElevenLabs voice distinct from Rupee's NBA1cQRTWFj793Oifdaj). (4) The TTS route (app/api/tts) routes to lib/integrations/elevenlabs.ts, which streams the audio from ElevenLabs (or falls back to OpenAI/shimmer). (5) The canvas animation syncs captions frame-by-frame and composites Mark's cartoon mascot image + headline speech bubble + CTA button + compliance footer (NMLS #2267023) into the video. For Anthropic usage: several backend routes (los/underwrite, pricing/capture, pricing/ingest, preapprovals/extract, los/extract, dealScreen) use raw fetch to https://api.anthropic.com/v1/messages with system prompt blocks, not Mark's persona—those are for underwriting/pricing analysis, not public-facing copy. Rupee (the agentic assistant) uses lib/gemini.ts which defaults to Claude (claude-opus-4-8) when ANTHROPIC_API_KEY is set, wrapping Anthropic calls in a Gemini-shaped interface.\"",
144	        "integrationPoints": [
145	          "MARK_VOICE_ID = \"nPczCjzI2devNBz1zQrb\" (ElevenLabs custom voice ID, distinct from Rupee's NBA1cQRTWFj793Oifdaj)",
146	          "MARK_SIGNOFF = \"Fetti Financial Services, we do money!\" (mandatory sign-off, enforced via withMarkSignoff())",
147	          "process.env.ANTHROPIC_MODEL || \"claude-opus-4-8\" (fallback model for underwriting/pricing routes; not used for Mark persona copy)",
148	          "process.env.ANTHROPIC_API_KEY (switches Rupee brain from Gemini/OpenAI to Claude)",
149	          "process.env.OPENAI_API_KEY (fallback TTS + used by adFactory for concept generation via gpt-4o-mini)",
150	          "process.env.ELEVENLABS_API_KEY (primary TTS provider; if missing, falls back to OpenAI)",
151	          "CEDI_PERSONA in lib/brand.ts (alternative Mark voice definition for social content, not currently used in adFactory)",
152	          "BRAND_BRIEF in lib/brand.ts (injected into other agent prompts, not Mark-specific)",
153	          "lib/integrations/elevenlabs.ts (both ElevenLabs + OpenAI TTS fallback)",
154	          "app/api/tts (public TTS endpoint routed through integrations)",
155	          "app/api/studio/image (DALL-E image generation endpoint called during video production)",
156	          "Canvas video rendering + MediaRecorder in app/studio/page.tsx (client-side video encoding)"
157	        ],
158	        "gaps": [
159	          "No anthropic-sdk or @anthropic-ai npm package imports; all Anthropic API calls are raw fetch() to https://api.anthropic.com/v1/messages. No official SDK client instantiation.",
160	          "MARK_PERSONA is never used in any Anthropic calls—it is only embedded in GPT-4o-mini system prompts via adFactory. Anthropic routes (underwriting, pricing) use their own domain-specific system prompts (e.g., \"You are a senior U.S. residential mortgage underwriter...\"), not Mark.",
161	          "adFactory generates concepts via OpenAI (gpt-4o-mini) only; no option to use Claude for concept generation, despite MARK_PERSONA existing as a shareable system prompt.",
162	          "No integration of Mark's voice or tone rules into backend Anthropic underwriting/pricing/extraction routes—those are pure technical analysis, not brand-voiced.",
163	          "No A/B testing or variant management for Mark sign-offs or tone within the system; sign-off enforcement is purely regex-based (regex strips dupes but no structured variant support).",
164	          "CEDI_PERSONA in brand.ts appears unused—it's a duplicate/alternative definition of Mark with slightly different phrasing, but the canonical source for ad generation is MARK_PERSONA in markPersona.ts. No code imports or uses CEDI_PERSONA."
165	        ],
166	        "codeSnippets": [
167	          "// Canonical Mark persona system prompt (from lib/markPersona.ts)\nimport { MARK_PERSONA, MARK_INFORMATIONAL, MARK_COMPANY_SIGNOFF } from \"@/lib/markPersona\";\n\nexport const MARK_SIGNOFF = \"Fetti Financial Services, we do money!\";\nexport const MARK_VOICE_ID = \"nPczCjzI2devNBz1zQrb\"; // ElevenLabs voice ID\nexport const MARK_PERSONA = `You are MARK — the Fetti Financial Services mascot, an owl and the face of the brand.\nWHO MARK IS: A cool, insightful money guide. Wise like an owl, articulate and composed... POSITIONING (critical): Fetti is your MORTGAGE SOLUTIONS SPECIALIST — we have the capital to fund loans directly... He says \"we've got the money\" / \"we fund it\" / \"we'll find the right solution\", but NEVER \"we'll find the money\"...\nALWAYS close with: \"${MARK_SIGNOFF}\"`;\n\nexport function withMarkSignoff(script: string): string {\n  const s = script.trim().replace(/\\s*Fetti[^.!?]*we do money[.!?]*\\s*$/i, \"\").trim();\n  return `${s} ${MARK_SIGNOFF}`;\n}",
168	          "// Representative GPT-4o-mini call with MARK_PERSONA injected (from lib/adFactory.ts)\nconst sys = `${MARK_PERSONA}\\n\\n${MARK_INFORMATIONAL}\\n\\nYou write short-form INFORMATIONAL-THAT-CONVERTS video concepts...`;\n\nconst r = await fetch(\"https://api.openai.com/v1/chat/completions\", {\n  method: \"POST\",\n  headers: { Authorization: `Bearer ${key}`, \"Content-Type\": \"application/json\" },\n  body: JSON.stringify({\n    model: \"gpt-4o-mini\",\n    response_format: { type: \"json_object\" },\n    temperature: 0.9,\n    messages: [\n      { role: \"system\", content: sys },\n      { role: \"user\", content: `Generate ${n} fresh ad concepts as JSON now.` }\n    ]\n  })\n});\nconst j = await r.json();\nconst parsed = JSON.parse(j.choices?.[0]?.message?.content || \"{}\");",
169	          "// Anthropic API call pattern (raw fetch; from app/api/los/underwrite/route.ts)\nconst key = process.env.ANTHROPIC_API_KEY;\nconst res = await fetch(\"https://api.anthropic.com/v1/messages\", {\n  method: \"POST\",\n  headers: { \"content-type\": \"application/json\", \"x-api-key\": key, \"anthropic-version\": \"2023-06-01\" },\n  body: JSON.stringify({\n    model: process.env.ANTHROPIC_MODEL || \"claude-opus-4-8\",\n    max_tokens: 2000,\n    system: SYSTEM,  // domain-specific prompt, NOT Mark's persona\n    messages: [{ role: \"user\", content: payload }]\n  })\n});\nconst j = await res.json();\nreturn (j.content || []).filter((b: any) => b.type === \"text\").map((b: any) => b.text).join(\"\");",
170	          "// Rupee's Claude brain integration (from lib/gemini.ts)\nconst CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || \"claude-opus-4-8\";\n\nfunction makeAnthropicModel() {\n  return {\n    startChat(opts: StartChatOpts = {}) {\n      return {\n        async sendMessage(input: string | unknown[], opts: { onDelta?: (t: string) => void } = {}): Promise<GeminiResponse> {\n          const reqBody = {\n            model: CLAUDE_MODEL,\n            max_tokens: maxTokens,\n            messages,\n            ...(hasTools ? { tools: anthropicTools, tool_choice: { type: \"auto\" } } : {})\n          };\n          const res = await fetch(\"https://api.anthropic.com/v1/messages\", {\n            method: \"POST\",\n            headers: { \"content-type\": \"application/json\", \"x-api-key\": anthropicKey as string, \"anthropic-version\": \"2023-06-01\" },\n            body: JSON.stringify(reqBody)\n          });\n          const json = await res.json();\n          if (!res.ok) throw new Error(json?.error?.message || `Anthropic HTTP ${res.status}`);\n          return { response: { text: () => /* text blocks */, functionCalls: () => /* tool blocks */ } };\n        }\n      };\n    }\n  };\n}",
171	          "// TTS voiceover generation with Mark's voice (from app/studio/page.tsx)\nimport { withMarkSignoff, MARK_VOICE_ID } from \"@/lib/markPersona\";\n\n// In Creative Studio, when user clicks \"Export video\":\nconst tr = await fetch(\"/api/tts\", {\n  method: \"POST\",\n  headers: { \"Content-Type\": \"application/json\" },\n  body: JSON.stringify({ text: spoken, voiceId: MARK_VOICE_ID })\n});\nconst audioBlob = await tr.blob();\n// Canvas syncs captions + composites Mark's image + background + compliance footer, then encodes to MP4"
172	        ]
173	      },
174	      {
175	        "subsystem": "Social Platform Integrations (Meta/Facebook/Instagram, TikTok)",
176	        "summary": "The Fetti CRM has deep integrations with Meta (Facebook/Instagram) for both lead generation (instant forms + Lead Ads webhook) and organic content publishing (daily auto-posts to owned Page + IG Business account). TikTok integration exists but requires app review for publishing. YouTube is referenced only for marketing attribution (utm_source), not as an owned posting platform. All credentials are stored in the Supabase app_settings table (DB-first), with env vars as fallback, enabling runtime self-healing of access tokens.",
177	        "files": [
178	          {
179	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/publish.ts",
180	            "role": "Core organic publishing to FB/IG; implements 3-step IG media container flow + FB photo/text posts"
181	          },
182	          {
183	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/metaHeal.ts",
184	            "role": "Token lifecycle: ingest user token, exchange for page token, self-refresh, webhook subscription, historical lead import"
185	          },
186	          {
187	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/metaCapi.ts",
188	            "role": "Meta Conversions API: server-side lead pixel events for campaign optimization"
189	          },
190	          {
191	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/tiktok.ts",
192	            "role": "TikTok OAuth + direct-post video to owned account; handles token refresh + privacy level auto-selection"
193	          },
194	          {
195	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/settings.ts",
196	            "role": "Runtime config abstraction: getSetting/setSetting/cfg() read from app_settings DB table, fall back to env"
197	          },
198	          {
199	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/meta/webhook/route.ts",
200	            "role": "Inbound webhook for FB Lead Ads instant forms; validates HMAC, fetches full lead, routes to /api/apply"
201	          },
202	          {
203	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/meta/setup/route.ts",
204	            "role": "One-shot Meta wiring: subscribe app to leadgen, subscribe page, heal token, test webhook"
205	          },
206	          {
207	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/meta/status/route.ts",
208	            "role": "Read-only: connection status for UI (FB Page name, IG username, canPublish flag)"
209	          },
210	          {
211	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/meta/campaign/route.ts",
212	            "role": "Inspect or re-activate lead campaigns; gates spend resume with explicit activate=1"
213	          },
214	          {
215	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/meta/spend/route.ts",
216	            "role": "Financial trace: daily/weekly/monthly spend per account, funding source, campaign spend breakdown"
217	          },
218	          {
219	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/meta/ads-report/route.ts",
220	            "role": "Diagnostic: all ad accounts, campaigns, lead forms, lifetime lead counts, plain-English verdict"
221	          },
222	          {
223	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/meta/import-leads/route.ts",
224	            "role": "Recover historical Meta Lead Ads leads (90+ days old); enumerate all pages, persist page token map, dedup by leadgen_id"
225	          },
226	          {
227	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/tiktok/publish/route.ts",
228	            "role": "Publish recorded video to TikTok; marks content_posts row as posted on success"
229	          },
230	          {
231	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/settings/meta-connect/route.ts",
232	            "role": "Owner-only Meta reconnect: accept pasted user token, exchange for page token, wire webhook subscriptions"
233	          },
234	          {
235	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/content/publish/route.ts",
236	            "role": "Approve & publish queued content post to all connected channels; calls publishPost()"
237	          },
238	          {
239	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/components/MetaConnect.tsx",
240	            "role": "Owner UI for Facebook login: paste user token, see connection status (Page name, IG @username)"
241	          }
242	        ],
243	        "howItWorks": "\n\n## Meta (Facebook Page + Instagram Business Account)\n\n**Owned Account Configuration:**\n- Facebook Page ID: stored as `META_PAGE_ID` in app_settings or env\n- Instagram Business Account ID: auto-discovered from the Page's linked `instagram_business_account` field; stored as `META_IG_USER_ID` in app_settings\n\n**Access Tokens:**\n1. **META_USER_TOKEN** (long-lived, ~60 days): Exchanged once when user pastes it in MetaConnect.tsx; refreshed auto-magically by healMetaToken() if expiring\n2. **META_ACCESS_TOKEN** (page token, ~60 days): Minted from META_USER_TOKEN by querying `/{PAGE_ID}?fields=access_token` with the long-lived user token; stores in app_settings; used for all Graph API calls (publishing, lead webhook, subscriptions)\n3. **META_CAPI_TOKEN** (optional, Conversions API token): Alternative to META_ACCESS_TOKEN for server-side lead events; falls back to META_USER_TOKEN then META_ACCESS_TOKEN\n\n**Required Scopes (pasted once in Graph API Explorer, MetaConnect.tsx line 57):**\n- `pages_show_list` — list all pages the user manages\n- `pages_read_engagement` — read page insights (not used for posting, but required for full setup)\n- **`pages_manage_posts`** — POST to `/{PAGE_ID}/feed` and `/{PAGE_ID}/photos` (REQUIRED for FB posting)\n- **`instagram_content_publish`** — POST media containers to `/{IG_USER_ID}/media` (REQUIRED for IG posting)\n- `instagram_basic` — read IG account linked to page\n- `leads_retrieval` — fetch full lead details from `/{LEADGEN_ID}` (REQUIRED for Lead Ads webhook)\n- `pages_manage_metadata` — subscribe page to webhook (REQUIRED for Lead Ads delivery)\n- `business_management` — manage ad accounts (used by metaSpendTrace)\n\n**Organic Content Publishing Flow (lib/publish.ts, publishPost()):**\n\n1. **Heal token** (meta/setup/route.ts, lib/metaHeal.ts): Validate META_ACCESS_TOKEN; if expiring/invalid, auto-refresh from META_USER_TOKEN via `fb_exchange_token` grant.\n\n2. **Facebook Page — Photo Post** (fbPhoto()):\n   ```\n   POST /v21.0/{PAGE_ID}/photos\n   body: { url: imageUrl, caption: fullCaption(post), access_token: token }\n   response: { id | post_id }\n   ```\n   - Image-only posts\n   - Caption includes mortgage compliance disclosure\n\n3. **Facebook Page — Text Post** (fbText()):\n   ```\n   POST /v21.0/{PAGE_ID}/feed\n   body: { message: fullCaption(post), access_token: token }\n   response: { id }\n   ```\n   - Text-only (no image)\n   - Used when post.image_url is null\n\n4. **Instagram Business Account — Image Post** (igPublish()):\n   - **Step 1: Create media container** (2-3 min wait required)\n     ```\n     POST /v21.0/{IG_USER_ID}/media\n     body: { image_url, caption, access_token: token }\n     response: { id } (container id)\n     ```\n   - **Step 2: Poll for processing** (loop up to 12x, 2.5s interval)\n     ```\n     GET /v21.0/{CONTAINER_ID}?fields=status_code&access_token={token}\n     wait for status_code === \"FINISHED\" or \"ERROR\"\n     ```\n   - **Step 3: Publish container** \n     ```\n     POST /v21.0/{IG_USER_ID}/media_publish\n     body: { creation_id: container_id, access_token: token }\n     response: { id } (published post id)\n     ```\n   - Image-only (Reels require video file, not generated by system)\n\n5. **TikTok**: Not yet working for organic posts; placeholder only (line 105 publish.ts). Requires approved Content Posting app.\n\n**Lead Ads + Webhook Flow (meta/webhook/route.ts):**\n1. Meta POST to `/api/meta/webhook` with `leadgen` event + HMAC-SHA256 signature\n2. Verify signature against `META_APP_SECRET`\n3. Fetch full lead from `/{LEADGEN_ID}` using page token (from `META_PAGE_TOKENS` map or `META_ACCESS_TOKEN` fallback)\n4. Map lead fields (first_name, email, phone, state, loan_purpose, property_value, credit_band)\n5. Route through `/api/apply` with internal secret to bypass rate limiter\n6. Never-lose-a-lead fallback: if Graph fetch fails, save partial lead to `leads` table + alert\n\n**Webhook Subscription (subscribeAppToLeadgen, subscribePageToLeadgen):**\n- **App subscription** (uses app access token `{APP_ID}|{APP_SECRET}`, done once per app):\n  ```\n  POST /v21.0/{APP_ID}/subscriptions\n  body: { object: \"page\", callback_url: https://app.fettifi.com/api/meta/webhook, fields: \"leadgen\", verify_token: META_WEBHOOK_VERIFY_TOKEN, access_token: {APP_ID}|{APP_SECRET} }\n  ```\n- **Page subscription** (uses page token or falls back to app token):\n  ```\n  POST /v21.0/{PAGE_ID}/subscribed_apps\n  body: { subscribed_fields: \"leadgen\", access_token: {token} }\n  ```\n\n**Page Token Map (META_PAGE_TOKENS):**\n- Historical import (importHistoricalLeads) enumerates ALL pages the user manages via `/{USER_TOKEN}/me/accounts`, stores `pageId -> pageToken` map as JSON string\n- Webhook uses this map to fetch leads from ANY page, not just the configured one\n- Enables multi-page setups without re-auth\n\n---\n\n## TikTok\n\n**Owned Account Configuration:**\n- No explicit user ID stored; OAuth returns `open_id` → stored as `TIKTOK_OPEN_ID` in app_settings\n- Creator info fetched on every status check; privacy_level_options determine if PUBLIC_TO_EVERYONE or SELF_ONLY\n\n**Access Tokens (lib/tiktok.ts):**\n1. **TIKTOK_CLIENT_KEY** + **TIKTOK_CLIENT_SECRET** (env or app_settings): OAuth app credentials\n2. **TIKTOK_ACCESS_TOKEN** (~24h): Minted via authorization code exchange; auto-refreshed if expiring >2h before expiry\n3. **TIKTOK_REFRESH_TOKEN** (~365d): Stored; used to refresh access token\n4. **TIKTOK_TOKEN_EXPIRES**: Timestamp; compared against Date.now() to trigger refresh\n5. **TIKTOK_OAUTH_STATE**: Temporary; cleared after callback\n\n**Required Scopes (built into SCOPES constant):**\n- `user.info.basic` — who's connected (fetch creator_nickname)\n- **`video.publish`** — direct-post to SELF_ONLY or PUBLIC_TO_EVERYONE (REQUIRED)\n- `video.upload` — upload draft (not used for direct post)\n\n**Organic Video Publishing (tiktokPublishVideo):**\n1. **Fetch video** from URL (e.g., Supabase Storage)\n2. **Query creator info** to get available privacy_level_options\n   ```\n   POST /v2/post/publish/creator_info/query/\n   headers: { Authorization: Bearer {token}, Content-Type: application/json }\n   response: { data: { privacy_level_options: [\"PUBLIC_TO_EVERYONE\"] | [\"SELF_ONLY\"] } }\n   ```\n3. **Pick privacy level**: PUBLIC_TO_EVERYONE (if audited) else SELF_ONLY\n4. **Init upload**\n   ```\n   POST /v2/post/publish/video/init/\n   body: { post_info: { title, privacy_level, disable_duet, disable_comment, disable_stitch, video_cover_timestamp_ms }, source_info: { source: \"FILE_UPLOAD\", video_size, chunk_size, total_chunk_count: 1 } }\n   response: { data: { publish_id, upload_url } }\n   ```\n5. **Upload file (single chunk)**\n   ```\n   PUT {upload_url}\n   headers: { Content-Type: video/mp4, Content-Range: bytes 0-{size-1}/{size} }\n   body: {video_buffer}\n   ```\n6. Return publish_id; /api/tiktok/publish marks content_posts row as posted\n\n**Connection Flow:**\n- /api/tiktok/auth: Build OAuth URL (tiktokAuthUrl) → redirect to TikTok login\n- /api/tiktok/callback: Exchange code for tokens (tiktokExchangeCode) → persist to app_settings\n- /api/tiktok/status: Call tiktokHeal (refresh if needed), query creator_info, return { configured, connected, canPublish, privacyOptions, username }\n\n**Token Refresh (tiktokHeal):**\n- Checks TIKTOK_TOKEN_EXPIRES vs Date.now(); refreshes if <2h until expiry\n- Always-on, called before every status check and publish\n\n---\n\n## YouTube\n\n**Status:** No organic posting integration. Only referenced for marketing attribution:\n- utm_source=youtube (app/tv/route.ts)\n- SMS opt-in campaign tagging (api/sms/inbound/route.ts)\n\n---\n\n## Conversions API (CAPI) — Server-Side Lead Pixel\n\n**Purpose:** Report \"Lead\" conversions to Meta Pixel so ad campaigns can optimize toward real leads (not just clicks).\n\n**Pixel ID:** Discovered (or auto-created) from ad account; stored as `META_PIXEL_ID` in app_settings\n\n**Token:** META_CAPI_TOKEN (or falls back to META_USER_TOKEN or META_ACCESS_TOKEN)\n\n**Event (sendMetaLeadEvent):**\n```\nPOST /v21.0/{PIXEL_ID}/events\nbody: { data: JSON.stringify([{\n  event_name: \"Lead\",\n  event_time: Math.floor(Date.now() / 1000),\n  action_source: \"website\",\n  event_id: lead.id,\n  event_source_url: ...,\n  user_data: { \n    em: [SHA256(email)], \n    ph: [SHA256(phone)], \n    fn: [SHA256(first_name)], \n    ln: [SHA256(last_name)], \n    st: [SHA256(state)], \n    fbc: \"fb.1.{ts}.{fbclid}\" \n  },\n  custom_data: { lead_source, content_name: loan_purpose }\n}]), access_token: token }\nresponse: { events_received }\n```\n- PII is SHA-256 hashed (required by Meta)\n- Never throws into request path (best-effort only)\n\n---\n\n## App Settings Table\n\nThe `app_settings` table (Supabase) is a simple key-value store: `{ key: string, value: string, updated_at: timestamp }`. All social credentials live here, not env vars.\n\n**Read path:** cfg(key) → getSetting(key) [from app_settings] → process.env[key] (fallback)\n**Write path:** setSetting(key, value) [upsert into app_settings with timestamp]\n\n",
244	        "integrationPoints": [
245	          "META_PAGE_ID — Facebook Page numeric id (env or app_settings); used for /feed, /photos, lead form subscription",
246	          "META_ACCESS_TOKEN — Long-lived page token (app_settings); rotates via healMetaToken(); used for all FB/IG posting and lead fetch",
247	          "META_USER_TOKEN — Long-lived user token (app_settings); pasted once in MetaConnect.tsx; exchanged for page token; refreshed auto",
248	          "META_APP_ID — Meta app numeric id (env or app_settings); used for app access token {APP_ID}|{APP_SECRET}",
249	          "META_APP_SECRET — Meta app secret (env or app_settings); used for app access token + webhook signature verification",
250	          "META_WEBHOOK_VERIFY_TOKEN — Custom string for webhook GET handshake (env or app_settings); set once in Meta dashboard",
251	          "META_IG_USER_ID — Instagram Business Account numeric id (app_settings, auto-discovered); used for /media, /media_publish",
252	          "META_PAGE_TOKENS — JSON map of { pageId: pageToken } (app_settings); populated by importHistoricalLeads; enables multi-page lead webhook fetch",
253	          "META_PIXEL_ID — Meta Pixel (dataset) id for Conversions API (app_settings); auto-discovered from ad account or created on first ensurePixel() call",
254	          "META_CAPI_TOKEN — Alternative Conversions API token (optional, app_settings or env); falls back to META_USER_TOKEN or META_ACCESS_TOKEN",
255	          "TIKTOK_CLIENT_KEY — TikTok app key (env or app_settings); required for OAuth authorize URL",
256	          "TIKTOK_CLIENT_SECRET — TikTok app secret (env or app_settings); required for code exchange",
257	          "TIKTOK_ACCESS_TOKEN — Access token (~24h, app_settings); auto-refreshed by tiktokHeal()",
258	          "TIKTOK_REFRESH_TOKEN — Refresh token (~365d, app_settings); used to mint new access tokens",
259	          "TIKTOK_TOKEN_EXPIRES — Expiry timestamp in ms (app_settings); compared vs Date.now() to trigger refresh",
260	          "TIKTOK_OPEN_ID — Creator open_id (app_settings); returned from OAuth but not directly used for publishing",
261	          "TIKTOK_REDIRECT_URI — OAuth callback URL (env, defaults to https://app.fettifi.com/api/tiktok/callback)",
262	          "TIKTOK_OAUTH_STATE — Temporary random state for CSRF (app_settings); cleared after /api/tiktok/callback",
263	          "CRON_SECRET — Shared secret for /api/meta/* routes + internal x-fetti-internal header (env); gates setup, campaign, spend, ads-report, import-leads",
264	          "NEXT_PUBLIC_APP_URL — Public app base URL (env, defaults to https://app.fettifi.com); used for webhook callback URL, webhook self-test",
265	          "supabase.app_settings table (key, value, updated_at) — Runtime config store; read by getSetting(), written by setSetting()",
266	          "supabase.content_posts table (id, type, caption, hashtags, image_url, status:'queued'|'posted', ...) — Queued posts; published by /api/content/publish",
267	          "supabase.leads table (full_name, email, phone, state, loan_purpose, source, lead_source, stage, notes, raw:{ meta: { leadgen_id, ... } }, ...) — CRM leads; populated by /api/meta/webhook and /api/meta/import-leads"
268	        ],
269	        "gaps": [
270	          "**FB/IG organic posting to multiple owned accounts:** Only one PAGE_ID + one linked IG account supported. Multi-page posting would require iterating owning accounts, storing multiple page tokens, and batch publishing—not implemented.",
271	          "**IG Reels/Stories:** publishPost() only handles static images (creates media container + publishes). Video Reels require uploading a video file first (multipart/form-data to /{IG_USER_ID}/media with media_type=VIDEO); Stories need different API (/nametag endpoint). Neither implemented.",
272	          "**YouTube organic channel posting:** No integration exists. Would need YouTube OAuth (scope youtube, youtube.upload) + channel id stored in app_settings + call to /youtube/v3/videos to insert. Zero current setup.",
273	          "**YouTube Shorts:** Same gap as Reels—would need video file + YouTube API integration.",
274	          "**TikTok direct-post:** Currently gated by 'requires approved app' (line 105 publish.ts). App is not yet audit-approved, so TIKTOK_ACCESS_TOKEN exists but privacy_level_options = ['SELF_ONLY'] (private only). Once approved, auto-upgrades to PUBLIC_TO_EVERYONE and publishing works.",
275	          "**TikTok Reels clone (drafts):** tiktokPublishVideo only does direct-post (video.publish scope). Draft upload (video.upload scope) not implemented.",
276	          "**LinkedIn organic posting:** No integration. Would require LinkedIn Marketing Developer Platform + OAuth + /me/posts endpoint.",
277	          "**Pinterest organic posting:** No integration. Would require Pinterest OAuth + board id + /pins endpoint.",
278	          "**FB Lead Ads to unlinked pages:** importHistoricalLeads enumerates all pages but only subscribes ones with a stored token. Pages without tokens get skipped (no per-page re-auth flow).",
279	          "**IG Lead Ads:** Instant forms can be created on IG but are tied to a linked Page. No separate IG-to-FB Lead Ads bridging; assumes all IG leads route via the linked Page.",
280	          "**Token scope validation before post attempt:** healMetaToken() validates token validity but not specific scopes (pages_manage_posts, instagram_content_publish). publishPost() will fail at Graph API call time if scopes are missing, with no pre-check.",
281	          "**Bulk/batch publishing:** publishPost() posts one post to all channels sequentially. No queue, retry, or batch scheduling logic.",
282	          "**Scheduling posts:** No scheduled_at field in content_posts table. All posts published immediately (via /api/content/publish or cron/content). No future-publish capability.",
283	          "**Post editing/deletion:** publishPost() is create-only. No endpoint to edit published posts or delete them from platforms.",
284	          "**Analytics/insights:** No fetching post-level metrics (likes, comments, shares, reach) back from platforms. metaSpendTrace() reads campaign spend only, not organic post performance.",
285	          "**Page/account switching:** UI always shows one Facebook Page (status.facebook.page). No picker for which Page to post to if user manages multiple.",
286	          "**Organic reach + ads combo:** Organic posts and Lead Ads are siloed. No cross-posting (e.g., organic post with a linked Lead form attached).",
287	          "**GDPR/CCPA consent:** Webhook intake stores consent, but no pre-flight consent check before posting (no consent_url or consent_text field). Posts are public by design.",
288	          "**Platform-specific formatting:** captions are identical across FB / IG. No hashtag, emoji, or URL shortening tweaks per platform.",
289	          "**Rate limiting:** No per-platform rate limit tracking. Could hit Meta's ~5 posts/hour limit or TikTok's ~10/day if posting too fast.",
290	          "**Webhook resilience:** If /api/meta/webhook is down when Meta sends a leadgen event, Meta will retry ~3 times then drop it. No dead-letter queue or replay mechanism.",
291	          "**Test mode:** meta/setup route has ?test=1 and ?capitest=1 flags, but no sandbox/test config for other APIs (just live mode)."
292	        ],
293	        "codeSnippets": [
294	          "// Publish an organic post to Facebook Page (text only):\nconst result = await publishPost({ caption: 'Hello world', type: 'text' });\n// → POST /v21.0/{META_PAGE_ID}/feed with full disclosure appended\n\n// Publish an organic post to Facebook Page + Instagram (photo):\nconst result = await publishPost({ caption: 'Photo', image_url: 'https://...', type: 'image' });\n// → POST /v21.0/{META_PAGE_ID}/photos + 3-step IG media container flow\n\n// Connect Meta (paste user token once):\nconst ingest = await ingestUserToken(userToken);\n// → POST /{PAGE_ID}?fields=access_token + subscribe webhooks → store META_ACCESS_TOKEN + META_USER_TOKEN\n\n// Publish to TikTok:\nconst publishId = await tiktokPublishVideo('https://supabase.../video.mp4', 'Check this out!');\n// → POST /v2/post/publish/video/init/ + PUT {upload_url} + auto-picks PUBLIC_TO_EVERYONE or SELF_ONLY\n\n// Read current token health:\nconst status = await healMetaToken();\n// → { status: 'healthy' | 'healed' | 'needs_reauth', daysLeft?: number }\n\n// Query connection UI state:\nconst conn = await metaConnectionStatus();\n// → { facebook: { connected, page }, instagram: { linked, canPublish, username } }\n\n// Inbound Lead Ads webhook (called by Meta):\nPOST /api/meta/webhook\nX-Hub-Signature-256: sha256={HMAC}\n{ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id, page_id, ... } }] }] }\n// → Verifies sig, fetches lead from Graph, maps to /api/apply, saves fallback if fetch fails\n\n// Import historical leads (one-shot recovery):\nconst report = await importHistoricalLeads();\n// → Enumerate all user's pages, fetch all leads from all forms (90d API window), insert to leads table\n\n// Read Facebook ad spend:\nconst trace = await metaSpendTrace();\n// → { accounts: [{ id, spend: { today, yesterday, last_7d, last_30d }, campaigns7d: [...] }] }\n\n// Inspect lead campaign:\nconst camp = await metaManageCampaign({ account: 'act_...', nameOrId: 'New Leads Campaign' });\n// → { campaign, adsets: [{...}], ads: [{...}], pageWired: { pageId: true/false } }\n\n// Re-activate a paused campaign (resumes spend):\nconst camp = await metaManageCampaign({ account: 'act_...', campaign: 'name', activate: true });\n// → Sets campaign + adsets + ads to ACTIVE\n\n// Send server-side lead event to Pixel:\nconst capi = await sendMetaLeadEvent({ id: '123', email: 'x@y.com', phone: '...', full_name: '...', state: 'CA', source: 'facebook' });\n// → POST /v21.0/{META_PIXEL_ID}/events with SHA256(email), SHA256(phone), etc.\n\n// Check TikTok status:\nconst tk = await tiktokStatus();\n// → { configured, connected, canPublish, username, privacyOptions: ['PUBLIC_TO_EVERYONE' | 'SELF_ONLY'], detail }"
295	        ]
296	      },
297	      {
298	        "subsystem": "Fetti CRM Social Proof Wall — Current State & Integration Map",


===== line 77 | user =====
298	        "subsystem": "Fetti CRM Social Proof Wall — Current State & Integration Map",
299	        "summary": "No social proof wall (reviews, testimonials, case studies, or \"trusted by\") exists in the Fetti CRM today. There are no Google Places review integrations, customer testimonial components, closed-loan wins display, or credential trust badges on public marketing surfaces. The applications table tracks status and loan amounts but is not exposed publicly. All marketing pages rely on founder authority, generic benefits positioning, and form CTAs, with zero defensible third-party proof points visible to prospects.",
300	        "files": [
301	          {
302	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/home/page.tsx",
303	            "role": "Primary public homepage with 10 marketing sections; currently missing social proof. Line 115-401 contains all sections. A proof wall would slot between 'Bank vs Broker' section (line 168-198) and 'Programs' section (line 200-232) OR between 'Why Fetti' (line 308-333) and 'FAQ' (line 335-354)."
304	          },
305	          {
306	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/lending/[slug]/page.tsx",
307	            "role": "SEO landing pages for individual loan products (DSCR, fix & flip, etc.). Each product page (lines 213-223) has an inline HeroCapture form and requirements list. A testimonial card specific to that product type (e.g., 'Real DSCR borrowers in [state]') would fit after 'Why borrowers choose' section (line 225-235) and before 'What you'll need' (line 237-244)."
308	          },
309	          {
310	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/lp/[product]/page.tsx",
311	            "role": "Paid landing pages (minimal, form-heavy). Lines 35-52 show two-column layout. A brief social proof card (2-3 reviews) would fit ABOVE the form (before line 50) as a trust anchor before the conversion request."
312	          },
313	          {
314	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/components/SiteHeader.tsx",
315	            "role": "Sticky header on all public marketing pages. Currently text/nav only; could add trust badges (NMLS verified, Google stars) inline at line 16 within nav if space permits."
316	          },
317	          {
318	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/components/HeroCapture.tsx",
319	            "role": "Inline homepage lead capture form. Renders on /home, /lending/[slug], and other pages. Form success state (lines 41-54) could display a referral + testimonial overlay (e.g., 'John M. just got funded for $450k DSCR in FL — join him')."
320	          },
321	          {
322	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/globals.css",
323	            "role": "Global styles + Google Places autocomplete theme. No review/testimonial component CSS. Brand uses emerald-600 (#10b981), gold, and slate palette (defined in tailwind.config.ts)."
324	          },
325	          {
326	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/tailwind.config.ts",
327	            "role": "Design system. Colors: slate (primary neutral), emerald-600 (primary brand green), teal/emerald gradients (accents). No custom review/card components defined. Uses default Tailwind spacing (px-6, py-20, rounded-2xl)."
328	          },
329	          {
330	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/places/key/route.ts",
331	            "role": "Google Maps API key server endpoint. Returns NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_MAPS_KEY env var. Currently used only for Maps SDK; NO Google Places Reviews API call exists. Would need to add a new /api/reviews or /api/places/reviews route to fetch actual Google Business reviews."
332	          },
333	          {
334	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/supabase/migrations/20251202093000_fix_rls_and_tables.sql",
335	            "role": "Database schema. 'applications' table (lines 21-30) has status, loan_amount, property_address, notes (JSONB). No 'testimonials', 'wins', 'case_studies', or 'reviews' table. New table(s) needed to store consented closed-loan wins (borrower first name, loan type, state, amount, testimonial_text, image_url) and Google Place reviews."
336	          }
337	        ],
338	        "howItWorks": "CURRENT STATE: Zero social proof infrastructure.\n\nPROPOSED DATA FLOW:\n1. Google Places Reviews (real, third-party):\n   - Create new /app/api/reviews/google/route.ts\n   - Use Google Places API (Places.GetReviews or SearchText + GetDetails) to fetch Fetti's Google Business listing reviews\n   - Cache them (e.g., 24h) in a new 'google_reviews' table or Redis/memory\n   - Each review: author name, rating (1-5 stars), text, review_date, reviewer avatar (if available)\n   - Endpoint returns paginated, star-filtered reviews (e.g., only 4-5 stars for marketing)\n\n2. Consented Closed-Loan Wins (internal, opt-in):\n   - Create new 'testimonials' table in Supabase with: id, lead_id, borrower_first_name, borrower_last_name (optional for privacy), loan_type (DSCR/fix-flip/home-purchase), state, loan_amount, closing_date, testimonial_text, reviewer_photo_url, consent_given_at, public (boolean), created_at\n   - After loan closes (flagged in applications.status = 'Funded'), loan officer sends consented borrower a request: 'Share your win with others — 30 seconds.'\n   - Borrower submits (name, loan type, amount, quote like 'Closed my $500k fix-flip in 14 days. Mark made it painless.') via a /components/WinSubmitForm.tsx component (embedded in borrower portal or email link)\n   - Data stored, marked public if consent = true\n   - Create /app/api/testimonials/list endpoint returning public wins (ordered by closing_date desc, randomized per render for freshness)\n\n3. Credential Trust Badges:\n   - NMLS badge component (/components/NMLSBadge.tsx): links to nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/2267023, displays 'Licensed Lender & Broker · NMLS #2267023' with official shield icon\n   - Equal Housing Opportunity badge (already in footer, could be prominent in hero)\n   - 'Verified by Google' badge (if using Google Places API, proves we're a real business with real reviews)\n   - These render in SiteHeader, hero section, and before CTA buttons\n\n4. UI Components:\n   - /components/SocialProofWall.tsx: full-width section with:\n     * Headline: 'Real wins. Real reviews. Real lenders.'\n     * 3-4 rotating/carousel reviews from Google Places (random sample, 4-5 stars only)\n     * 2-3 consented borrower wins (DSCR $450k in FL, Fix-flip $280k in TX, Home purchase $650k in CA)\n     * Star ratings and dates prominent\n   - /components/TestimonialCard.tsx: individual card for each review/win (author, stars, quote, loan type/amount if from wins, date)\n   - /components/TrustBadgeRow.tsx: NMLS + Equal Housing + Google Verified icons in a row\n   - Styling: match existing slate/emerald palette, use card borders (border-slate-200), rounded-2xl, shadow-sm, hover effects (border-emerald-300, shadow-lg on desktop)\n\n5. Integration Points:\n   - /app/home/page.tsx: Insert SocialProofWall after Bank vs Broker comparison (line 198) as a proof anchor between 'Why Fetti' and 'Programs'\n   - /app/lending/[slug]/page.tsx: Insert product-specific wins (filter by loan_type) after 'Why borrowers choose' (line 236)\n   - /app/lp/[product]/page.tsx: Insert brief 2-review card ABOVE form (line 49), or as footer trust row\n   - /components/SiteHeader.tsx: Add TrustBadgeRow on right side (line 16) with NMLS, Google verified icons\n   - Borrower portal: New 'Share your win' section after application is closed, links to /share-your-win or embedded WinSubmitForm",
339	        "integrationPoints": [
340	          "GOOGLE_MAPS_KEY / NEXT_PUBLIC_GOOGLE_MAPS_KEY env var — currently used only for Maps SDK; must extend /app/api/places/key/route.ts or create new /app/api/reviews/google/route.ts to fetch Google Business reviews via Google Places API or Search + Details call",
341	          "Supabase postgres database — new 'testimonials' table needed (id, lead_id, borrower_first_name, loan_type, state, loan_amount, closing_date, testimonial_text, reviewer_photo_url, consent_given_at, public, created_at)",
342	          "Google Places API endpoints: Places.Search (find Fetti's business) → Places.Details (fetch reviews, rating, photos) or SearchNearby + GetDetails if using newer SDK",
343	          "applications table in Supabase — must add a 'testimonial_requested_at' and 'testimonial_status' field to track whether closing lead was asked to share their win",
344	          "Email/SMS automation — /app/api/automations or existing /app/api/meta/... route to trigger 'Share your win' request when applications.status = 'Funded'",
345	          "Borrower portal (/app/portal/[id]/page.tsx) — needs new section or modal to collect WinSubmitForm after loan closes",
346	          "ENV vars needed: GOOGLE_PLACES_API_KEY (if using Places API), optionally REDIS_URL for review caching to avoid API rate limits",
347	          "Tailwind design tokens: use existing emerald-600, slate-200, slate-900, rounded-2xl, shadow-sm, py-20, px-6 conventions (already defined in globals.css and home/page.tsx sections)"
348	        ],
349	        "gaps": [
350	          "No testimonials/reviews data table — must create Supabase 'testimonials' table to store consented borrower wins",
351	          "No Google Places API integration — /app/api/places exists but only returns Maps key; must add logic to fetch Business reviews (requires Google Places API setup, possibly Places Details endpoint, and handling rate limits/caching)",
352	          "No UI components for reviews/testimonials — SocialProofWall, TestimonialCard, TrustBadgeRow components do not exist; must design & build matching existing emerald/slate palette",
353	          "No consent/collection flow — no borrower-facing 'Share your win' form or email automation to solicit testimonials after loan closes; WinSubmitForm component must be built and integrated into portal + closing automation",
354	          "No reviewer photos/avatars — Google Places reviews may include reviewer avatars; borrower wins will need optional photo upload in submission form, and /public/testimonials storage bucket",
355	          "No filtering/moderation — social proof components will display raw reviews; need either manual approval step (LO reviews before public) or automatic filtering (5-star only from Google, explicit consent for borrower wins)",
356	          "No analytics/tracking — no way to measure if reviews/social proof components improve conversion; could add UTM params or event tracking to /apply forms from social-proof-exposed pages",
357	          "No mobile optimization shown — components assumed responsive but not explicitly designed; TestimonialCard and SocialProofWall must be carousel/grid on mobile (sm: 1 col, md: 2, lg: 3+)",
358	          "No rate/approval promises compliance risk — must ensure review display never implies guaranteed rates/approval; add footer disclaimer on social-proof sections: 'Testimonials and reviews are from real borrowers. Rates, terms, and approval vary by scenario. See terms & conditions.'",
359	          "No A/B testing infrastructure — no way to test if social proof wall actually moves the needle on CTR or conversion; consider utm_source='social_proof' tagging to measure impact",
360	          "No GDPR/CCPA compliance for Google review display — Google reviews may contain EU borrower data; must respect privacy laws if marketing to EU residents",
361	          "No refresh strategy — reviews are static once cached; Google Places reviews should refresh daily/weekly; borrower wins should refresh on new testimonial submission"
362	        ],
363	        "codeSnippets": [
364	          "// Fetch Google Business reviews (new /app/api/reviews/google/route.ts)\nimport { NextResponse } from 'next/server';\nexport async function GET() {\n  const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;\n  const FETTI_PLACE_ID = 'YOUR_PLACE_ID'; // Get from Places API Console\n  const url = `https://places.googleapis.com/v1/places/${FETTI_PLACE_ID}?fields=reviews,rating,userRatingCount&key=${GOOGLE_PLACES_API_KEY}`;\n  const resp = await fetch(url);\n  const data = await resp.json();\n  return NextResponse.json({\n    reviews: data.reviews?.filter((r: any) => r.rating >= 4) || [],\n    rating: data.rating,\n    count: data.userRatingCount,\n  }, { headers: { 'Cache-Control': 'public, max-age=86400' } });\n}\n",
365	          "// Testimonials table schema (Supabase migration)\ncreate table if not exists testimonials (\n  id uuid default uuid_generate_v4() primary key,\n  lead_id uuid references leads(id),\n  borrower_first_name text not null,\n  borrower_last_name text,\n  loan_type text not null, -- 'DSCR', 'fix-flip', 'home-purchase', etc.\n  state text not null,\n  loan_amount numeric,\n  closing_date date,\n  testimonial_text text not null,\n  reviewer_photo_url text,\n  consent_given_at timestamp with time zone,\n  public boolean default false,\n  created_at timestamp with time zone default now()\n);\nalter table testimonials enable row level security;\ncreate policy \"Allow public select testimonials\" on testimonials for select using (public = true);\n",
366	          "// SocialProofWall component (new /components/SocialProofWall.tsx)\nexport function SocialProofWall({ googleReviews, borrowerWins }: Props) {\n  return (\n    <section className=\"max-w-6xl mx-auto px-6 py-20 border-t border-slate-100\">\n      <div className=\"text-center mb-12\">\n        <h2 className=\"text-3xl sm:text-4xl font-bold text-slate-900\">Real wins. Real reviews. Real lenders.</h2>\n      </div>\n      <div className=\"grid md:grid-cols-2 lg:grid-cols-3 gap-6\">\n        {[...googleReviews.slice(0, 2), ...borrowerWins.slice(0, 1)].map((item) => (\n          <TestimonialCard key={item.id} review={item} />\n        ))}\n      </div>\n    </section>\n  );\n}\n",
367	          "// TestimonialCard component (new /components/TestimonialCard.tsx)\nexport function TestimonialCard({ review }: { review: GoogleReview | BorrowerWin }) {\n  const isWin = 'loan_type' in review;\n  return (\n    <div className=\"rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg hover:border-emerald-300 transition\">\n      <div className=\"flex items-start justify-between mb-3\">\n        <div>\n          <p className=\"font-semibold text-slate-900\">{review.author}</p>\n          <p className=\"text-xs text-slate-500\">{isWin ? review.loan_type : 'Google'}</p>\n        </div>\n        <div className=\"flex gap-0.5\">{'★'.repeat(review.rating)}</div>\n      </div>\n      <p className=\"text-slate-700 text-sm leading-relaxed italic\">'{review.text}'</p>\n      {isWin && <p className=\"text-xs text-emerald-600 mt-3 font-semibold\">{review.loan_amount?.toLocaleString()} {review.state}</p>}\n      <p className=\"text-xs text-slate-400 mt-3\">{new Date(review.date).toLocaleDateString()}</p>\n    </div>\n  );\n}\n"
368	        ]
369	      },
370	      {
371	        "subsystem": "Fetti CRM Data/Persistence & Auth Layer",
372	        "summary": "The Fetti CRM uses Supabase as its primary backend with two client patterns: browser-side anon client (via SSR createBrowserClient for cookie-based session) for public/borrower flows, and server-side service-role client for admin/internal APIs. Auth is enforced by a middleware proxy (proxy.ts) that checks session cookies and gates protected routes (CRM pages + internal APIs) with 401/redirect responses. Settings and runtime config store in an app_settings table via service-role, accessed through getSetting/setSetting helpers. Storage uses \"loan-docs\" and \"content\" buckets for document persistence. RLS is currently permissive (public insert/select) on public tables (leads, applications, referrals) but service-role bypasses RLS entirely for internal operations.",
373	        "files": [
374	          {
375	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/supabaseClient.ts",
376	            "role": "Browser/SSR client (anon key, cookie-based session, used by borrower portal + public flows)"
377	          },
378	          {
379	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/supabaseAdminClient.ts",
380	            "role": "Server-only service-role client (used by /api routes and lib helpers)"
381	          },
382	          {
383	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/settings.ts",
384	            "role": "App settings read/write helper (getSetting, setSetting, cfg pattern)"
385	          },
386	          {
387	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/proxy.ts",
388	            "role": "Next.js middleware auth gate (checks session, protects routes/APIs)"
389	          },
390	          {
391	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/settings/rates/route.ts",
392	            "role": "Representative protected API route (reads/writes app_settings)"
393	          },
394	          {
395	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/pricing/feed/route.ts",
396	            "role": "Bearer token auth pattern (machine-to-machine, bypasses session auth)"
397	          },
398	          {
399	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/supabase/migrations/20251202093000_fix_rls_and_tables.sql",
400	            "role": "RLS policy examples (public insert/select on leads, applications, referrals)"
401	          },
402	          {
403	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/supabase/migrations/20251202081206_create_storage_bucket.sql",
404	            "role": "Storage bucket setup (documents, loan-docs, content buckets)"
405	          }
406	        ],
407	        "howItWorks": "**Supabase Clients:**\\n- Browser: supabaseClient.ts uses createBrowserClient(url, anonKey) with SSR wrapper → cookie-based session, shared with login page, enables RLS-protected reads. Falls back to mock if env vars missing.\\n- Server: supabaseAdminClient.ts uses createClient(url, serviceRoleKey) with persistSession: false → bypasses RLS, used for internal CRUD and settings. Service role key from SUPABASE_SERVICE_ROLE_KEY env var.\\n\\n**Auth Flow (proxy.ts):**\\n1. Proxy intercepts all requests (except static, favicon, /api, /portal)\\n2. On every request: createServerClient creates anon client, calls supabase.auth.getSession() to extract session from cookies\\n3. If session exists: user is authenticated\\n4. If session missing + path in protectedRoutes (e.g., /leads, /pipeline, /dashboard) → redirect to /login with redirectedFrom param\\n5. If session missing + path in apiProtected (e.g., /api/los, /api/stats, /api/settings) → return 401 JSON (no redirect)\\n6. Special case: tokenAuthedApis (e.g., /api/pricing/feed) bypass session check; the route itself validates Bearer token via timingSafeEqual()\\n7. If session exists + path=/login → redirect to /leads\\n\\n**Settings Pattern (lib/settings.ts):**\\n- getSetting(key): SELECT value FROM app_settings WHERE key = ? LIMIT 1 (via supabaseAdmin, returns value or null)\\n- setSetting(key, value): UPSERT INTO app_settings (key, value, updated_at) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=NOW()\\n- cfg(key): query getSetting first, fall back to process.env[key] (DB overrides env for runtime-writable config)\\n\\n**API Route Auth (example /api/settings/rates):**\\n1. Route is in apiProtected list → proxy.ts checks session before request reaches handler\\n2. Handler uses supabaseAdmin to read/write (service role, no RLS)\\n3. Typical pattern: GET reads app_settings via getSetting, POST validates input + calls setSetting with stringified JSON\\n4. If validation fails: return 422. If Supabase error: return 500. Success: return 200 JSON.\\n\\n**Storage:**\\n- loan-docs bucket (private, via service role): loan files, documents, signed PDFs. Path scheme: {fileId}/{filename}\\n- content bucket (public): auto-generated social content images. Path scheme: auto/{timestamp}-{random}.jpg. Returns getPublicUrl() for direct embedding.\\n- documents bucket: for borrower file uploads (migrations define public insert+select RLS).\\n\\n**RLS on Public Tables:**\\n- leads, applications, referrals, verifications: \"Allow public insert/select/update\" policies (used by borrower portal chat + application flow)\\n- All policies use WITH CHECK (true) or USING (true) → wide open\\n- Service-role client bypasses RLS entirely, used by internal /api routes\\n\\n**Token Auth Example (/api/pricing/feed):**\\n1. Expected token from cfg(\\\"PRICING_FEED_TOKEN\\\") (app_settings or env)\\n2. Client sends: Authorization: Bearer <token>\\n3. Route extracts token, uses crypto.timingSafeEqual() for constant-time comparison\\n4. If mismatch: return 401. If token missing/not configured: return 503 (fail-closed)\\n5. On success: upsert pricing products to comparison engine\"",
408	        "integrationPoints": [
409	          "NEXT_PUBLIC_SUPABASE_URL (browser client, anon key - public)",
410	          "NEXT_PUBLIC_SUPABASE_ANON_KEY (browser client - public)",
411	          "SUPABASE_SERVICE_ROLE_KEY (server-only - private, from .env.local)",
412	          "app_settings table (key-value store for runtime config: PRICER_RATE_MODEL, LOAN_MARGIN_PCT, PRICING_FEED_TOKEN, META_PIXEL_ID, etc.)",
413	          "loan-docs storage bucket (private, service-role only, loan files + documents)",
414	          "content storage bucket (public, auto-generated social images)",
415	          "documents storage bucket (public, borrower uploads)",
416	          "Supabase auth system (session via cookies, getSession() in proxy + browser client)",
417	          "ANTHROPIC_API_KEY (used by /api/pricing/feed for text parsing to structured JSON)"
418	        ],
419	        "codeSnippets": [
420	          "// (a) Reading and writing app_settings from a server route\nimport { getSetting, setSetting } from \"@/lib/settings\";\n\nexport async function GET() {\n  const pct = Number(await getSetting(\"LOAN_MARGIN_PCT\")) || 2.75;\n  return NextResponse.json({ pct });\n}\n\nexport async function POST(req: NextRequest) {\n  const body = await req.json().catch(() => ({}));\n  const pct = Number(body?.pct);\n  if (!isFinite(pct) || pct < 0 || pct > 100) {\n    return NextResponse.json({ error: \"margin must be 0–100\" }, { status: 422 });\n  }\n  await setSetting(\"LOAN_MARGIN_PCT\", String(pct));\n  return NextResponse.json({ ok: true, pct });\n}",
421	          "// (b) Constructing the server-only service Supabase client\n// lib/supabaseAdminClient.ts\nimport { createClient } from \"@supabase/supabase-js\";\n\nconst supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;\nconst serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // <- env var\n\nlet supabaseAdmin: any;\nif (supabaseUrl && serviceRoleKey) {\n  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {\n    auth: { persistSession: false },\n  });\n} else {\n  // Mock fallback for build-time missing env vars\n  supabaseAdmin = { from: () => mockBuilder, auth: { admin: {...} } };\n}\n\nexport { supabaseAdmin };",
422	          "// (c) Auth check in proxy.ts (middleware protects all routes)\nimport { createServerClient } from '@supabase/ssr';\n\nexport async function proxy(request: NextRequest) {\n  // Create server client (anon key)\n  const supabase = createServerClient(\n    process.env.NEXT_PUBLIC_SUPABASE_URL!,\n    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\n    { cookies: { /* cookie handlers */ } }\n  );\n  // Extract session from cookies\n  const { data } = await supabase.auth.getSession();\n  const session = data.session;\n  \n  const path = request.nextUrl.pathname;\n  \n  // Protected API routes → return 401 if no session\n  const apiProtected = ['/api/los', '/api/stats', '/api/settings', ...]\n  if (apiProtected.some(route => path.startsWith(route)) && !session) {\n    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });\n  }\n  \n  // Protected pages → redirect to login if no session\n  const protectedRoutes = ['/leads', '/pipeline', '/dashboard', ...]\n  if (protectedRoutes.some(route => path.startsWith(route)) && !session) {\n    const redirectUrl = request.nextUrl.clone();\n    redirectUrl.pathname = '/login';\n    redirectUrl.searchParams.set('redirectedFrom', request.nextUrl.pathname);\n    return NextResponse.redirect(redirectUrl);\n  }\n  \n  return NextResponse.next();\n}",
423	          "// Token-authenticated API (machine-to-machine, no session required)\nimport crypto from \"crypto\";\nimport { cfg } from \"@/lib/settings\";\n\nfunction tokenOk(provided: string, expected: string): boolean {\n  const a = Buffer.from(provided), b = Buffer.from(expected);\n  if (a.length !== b.length) return false;\n  return crypto.timingSafeEqual(a, b); // constant-time comparison\n}\n\nexport async function POST(req: NextRequest) {\n  // Token stored in app_settings (runtime config)\n  const expected = await cfg(\"PRICING_FEED_TOKEN\");\n  if (!expected) return NextResponse.json({ error: \"not configured\" }, { status: 503 });\n  \n  const auth = req.headers.get(\"authorization\") || \"\";\n  const token = auth.startsWith(\"Bearer \") ? auth.slice(7) : \"\";\n  if (!token || !tokenOk(token, expected)) {\n    return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\n  }\n  // Handler logic here\n}"
424	        ],
425	        "gaps": [
426	          "No testimonial/review or social-proof table exists in the schema. To store reviews/testimonials: need to create a table (testimonials: id, author, content, rating, featured_at, verified_source) with RLS policy that allows public insert (via borrower portal) but restricts select/update to authenticated admins or service-role for moderation.\n\nFor generated posts (content.ts generates Reel scripts + AI images): content_posts table exists and is updated via /api/tiktok/publish. But no RLS defined yet for content_posts — currently relies on service-role client in /api routes. Need to add RLS: allow insert only if actor is authenticated admin, allow select by all (public feed), allow update/delete only by owner or admin.\n\nStorage RLS: loan-docs and content buckets use service-role for writes; no column-level security (all users via service role see all files). For multi-tenant or privacy-sensitive data, need to add storage policies (e.g., storage policies that check auth context or path patterns like owner_id/{file}).\n\nNo soft-delete or audit trail on settings. setSetting overwrites silently; no versioning or change log. For compliance (loan audit trails), consider adding a settings_audit table to log who changed what when."
427	        ]
428	      },
429	      {
430	        "subsystem": "Media-Generation Subsystem (Fetti Creative Studio & Auto Content Engine)",
431	        "summary": "The Fetti media-generation subsystem is a two-tier system: (1) Creative Studio (/app/studio/page.tsx) — an in-CRM web canvas that renders branded single-image PNG ads or multi-scene animated MP4 videos with Mark (golden-owl mascot) voiced by ElevenLabs, captions synced to voiceover, and full compliance footer burned in; and (2) Auto Content Engine (/lib/content.ts) — daily-cron-generated Reel/TikTok scripts + captions + hashtags + AI-generated background image (OpenAI DALL-E 3 / gpt-image-1), branded with Mark's mascot badge overlay via Sharp. Generated media (Studio exports and auto-content images) is uploaded directly to Supabase Storage (/content bucket), returned as public URLs, and wired into the publishPost() chain — Meta (Instagram/Facebook Graph API) pulls image_url directly; TikTok requires video files uploaded via signed Supabase URL.",
432	        "files": [
433	          {
434	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/studio/page.tsx",
435	            "role": "Client-side creative editor. Canvas-based single & batch video/image export, Mark voiceover (ElevenLabs TTS), MediaRecorder for MP4/WebM video, download to browser."
436	          },
437	          {
438	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/studio/image/route.ts",
439	            "role": "Branded image generator. OpenAI gpt-image-1 background generation, data URL return (used by Studio canvas overlay)."
440	          },
441	          {
442	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/studio/storyboard/route.ts",
443	            "role": "Storyboard API for multi-scene animated shorts. Returns beat structure (voiceover, captions, image prompts) from OpenAI gpt-4o-mini."
444	          },
445	          {
446	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/content/video/route.ts",
447	            "role": "Video upload-URL signer. Issues signed Supabase Storage upload tokens so Studio can upload recorded video directly (bypasses Vercel 4.5MB limit)."
448	          },
449	          {
450	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/content.ts",
451	            "role": "Auto-content generation engine. Generates Reel scripts + captions via OpenAI, calls generateImage() for branded backgrounds, inserts rows into content_posts table."
452	          },
453	          {
454	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/publish.ts",
455	            "role": "Social publishing orchestrator. Reads image_url from post, publishes to Meta (IG/FB Graph API) or text-only. TikTok video publish delegated to tiktok.ts."
456	          },
457	          {
458	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/tiktok.ts",
459	            "role": "TikTok Content Posting integration. Accepts public video URL, uploads via TikTok's init/upload/publish flow, auto-selects privacy level (PUBLIC or SELF_ONLY pending audit)."
460	          },
461	          {
462	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/supabaseAdminClient.ts",
463	            "role": "Supabase storage and database client. Manages /content bucket (image/video storage) and content_posts table (queue, metadata)."
464	          },
465	          {
466	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/adFactory.ts",
467	            "role": "Ad concept generation. generateAdConcepts() and generateStoryboard() — OpenAI-powered ideation in Mark's voice, cached daily."
468	          },
469	          {
470	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/markPersona.ts",
471	            "role": "Mark persona & voiceover config. Defines MARK_VOICE_ID (ElevenLabs voice token), signoff, and character guidelines for all content."
472	          },
473	          {
474	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/cron/content/route.ts",
475	            "role": "Daily content generation cron. Calls generateBatch(), inserts to content_posts, auto-publishes ONE image post per day to Meta (full automation)."
476	          },
477	          {
478	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/studio/ideas/route.ts",
479	            "role": "Creative idea cache. GET returns cached daily ideas; POST generates fresh batch (adFactory.generateAdConcepts), stores in app_settings."
480	          },
481	          {
482	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/studio/aivideo/route.ts",
483	            "role": "True AI video animation bridge (dormant). Accepts prompt + image, routes to FAL/Runway/Replicate for Kling/Veo image-to-video if key configured."
484	          },
485	          {
486	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/tiktok/publish/route.ts",
487	            "role": "TikTok direct-publish endpoint. Accepts videoUrl (Supabase public URL) + caption, calls tiktokPublishVideo()."
488	          },
489	          {
490	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/app/api/content/publish/route.ts",
491	            "role": "Approve & publish orchestrator. Pulls image_url from content_posts, calls publishPost() to Meta channels."
492	          },
493	          {
494	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/cediBadge.ts",
495	            "role": "Mark mascot badge (base64 PNG). Overlaid on auto-generated images via Sharp compositing in lib/content.ts."
496	          },
497	          {
498	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/brand.ts",
499	            "role": "Brand voice & persona. CONTENT_PERSONALITY, CEDI_PERSONA, BRAND_BRIEF — injected into all LLM prompts."
500	          },
501	          {
502	            "path": "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/legal.ts",
503	            "role": "Compliance disclosures. SOCIAL_DISCLOSURE (NMLS #2267023, Equal Housing) — auto-appended to all post captions."
504	          }
505	        ],
506	        "howItWorks": "## Image Generation (Studio & Auto-Content)\n\n**Studio (Single & Batch)**:\n1. User enters image prompt → Studio calls `POST /api/studio/image` with { prompt, size (1024x1024|1024x1536|1536x1024) }\n2. Route queries OpenAI API (gpt-image-1) with style suffix (BRANDED, MASCOT, or PHOTO)\n3. OpenAI returns b64_json → converted to data URL → displayed in canvas preview\n4. User composites Mark, headline, CTA, captions, compliance footer via canvas2d → downloadPng() → local download OR recordOne() → browser MediaRecorder + ElevenLabs TTS voiceover → MP4/WebM blob → downloadBlob()\n\n**Auto-Content (Daily Cron)**:\n1. `GET /api/cron/content` (or manual POST) → calls generateBatch(topic)\n2. generateBatch() calls generatePosts(6) → OpenAI gpt-4o-mini returns 6 scripts+captions+hashtags\n3. For each script, generateImage() is called:\n   - Randomly picks from IMAGE_CONCEPTS array\n   - Calls OpenAI gpt-image-1 with \"ORIGINAL CARTOON BRAND MASCOT\" or photo prompt\n   - Receives b64_json → converts to Buffer\n   - Calls brandWithCedi(jpeg) → Sharp overlay of CEDI_BADGE_B64 (Mark mascot) on bottom-right\n   - Uploads branded image to Supabase `content` bucket at path `auto/{timestamp}-{random}.jpg`\n   - Returns public URL (via getPublicUrl()) → stored in content_posts.image_url\n4. Inserts 3 reel rows (image_url: null) + 1 image post row (image_url: public URL) into content_posts table\n5. Auto-publishes ONE image post to Meta channels if configured (no approval needed)\n\n## Video Generation\n\n**Studio Single & Batch Mark Videos**:\n1. recordOne(scene) orchestrates the flow:\n   - Primes canvas with drawScene() at start frame\n   - Captures video stream via canvas.captureStream(30fps)\n   - If voiceover enabled: calls `POST /api/tts` with text + MARK_VOICE_ID (ElevenLabs voice \"nPczCjzI2devNBz1zQrb\")\n   - Creates AudioContext, connects audio to MediaStream tracks\n   - Uses requestAnimationFrame loop to animate Mark (entrance, bob, talk), captions (chunked via chunkScript()), hook fade, zoom\n   - recordOne() records for 4–30s, returns { blob, ext: \"mp4\"|\"webm\" }\n   - User downloads locally via downloadBlob()\n\n**Animated Multi-Scene Short** (recordProduction):\n1. User clicks \"Produce animated short\" → calls produceShort()\n2. Calls `POST /api/studio/storyboard` → OpenAI gpt-4o-mini generates N beats { kind, vo, caption, bigText, bgPrompt }\n3. For each beat, genBgImage(bgPrompt) → Studio image API → cartoon scene image (data URL)\n4. recordProduction(storyboard, bgImages) orchestrates:\n   - Records Mark voiceover once for entire script (all beats concatenated)\n   - requestAnimationFrame loop times each beat by voiceover length (weighted by character count)\n   - drawProductionFrame() animates: Ken Burns zoom+drift per beat, Mark entrance+bob+talk, captions word-by-word reveal, bigText pop, progress bar, compliance footer\n   - Returns { blob, ext }\n5. User downloads locally\n\n**Video Upload to Supabase (for TikTok publishing)**:\n1. Browser calls `POST /api/content/video` with { filename }\n2. Route generates path = `tiktok/{timestamp}-{random}.{ext}`\n3. Creates signed upload URL via supabaseAdmin.storage.from(\"content\").createSignedUploadUrl(path)\n4. Returns { signedUrl, publicUrl, path, token }\n5. Browser PUT's recorded blob directly to signedUrl (bypasses Vercel's 4.5MB limit)\n6. When publish occurs, TikTok endpoint receives publicUrl, calls tiktokPublishVideo(publicUrl, caption)\n\n## Publishing to Organic Social\n\n**Meta (Instagram + Facebook)**:\n1. User clicks \"Approve & Publish\" → `POST /api/content/publish/route` with { id }\n2. Loads post from content_posts table → calls publishPost(post)\n3. publishPost():\n   - Heals Meta token (refresh if needed)\n   - Instagram (if igUser && post.image_url):\n     - POST /graph/v21.0/{igUserId}/media with { image_url, caption }\n     - Polls status until FINISHED (avoids \"Media ID not available\")\n     - POST /graph/v21.0/{igUserId}/media_publish with { creation_id }\n   - Facebook (if pageId):\n     - POST /graph/v21.0/{pageId}/photos with { url: image_url, caption } OR\n     - POST /graph/v21.0/{pageId}/feed with { message } if image_url is null\n   - Caption always includes SOCIAL_DISCLOSURE (NMLS #2267023, Equal Housing)\n4. Returns { connected, channels: [{platform, ok, detail}] }\n5. If success, marks post status: \"posted\"\n\n**TikTok**:\n1. User or cron supplies video via `POST /api/tiktok/publish` with { videoUrl (Supabase public URL), caption, id (optional content_posts id) }\n2. tiktokPublishVideo(videoUrl, caption):\n   - Heals TikTok token (refresh if expiring)\n   - Fetches video from publicUrl → validates size < 64MB\n   - Creator info query → selects privacy level (PUBLIC_TO_EVERYONE if approved, else SELF_ONLY)\n   - POST /v2/post/publish/video/init → gets publish_id + upload_url\n   - PUT upload_url with video buffer + Content-Range header\n   - Returns publish_id\n3. Marks post status: \"posted\"\n\n## Storage Architecture\n\n**Supabase Storage (`content` bucket)**:\n- `auto/{timestamp}-{random}.jpg` — auto-generated branded images (image_url in content_posts)\n- `tiktok/{timestamp}-{random}.{mp4|webm}` — user-recorded videos for TikTok publishing (signed upload)\n- Public URL pattern: `https://{SUPABASE_URL}/storage/v1/object/public/content/{path}`\n\n## Compliance & Branding\n\n**Every export includes**:\n- NMLS #2267023 (Fetti Financial Services LLC) in canvas footer (17px, 85% alpha)\n- \"Equal Housing Opportunity\" disclosure\n- Mark mascot (golden-owl PNG overlay, bottom-right, auto-content) or on-screen (Studio video)\n- SOCIAL_DISCLOSURE appended to all captions (NMLS, state licenses, \"not a commitment to lend\")\n\n**Fonts & Logo**:\n- Canvas fonts: `-apple-system, \"Inter\", Arial` (fallback chain for cross-platform)\n- Mark mascot: `/mark-golden-owl.png` (loaded client-side)\n- Fetti emblem: `/fetti-emblem.png` (loaded client-side)\n- CEDI badge: base64-encoded PNG in cediBadge.ts (composited via Sharp on auto-images)",
507	        "integrationPoints": [
508	          "OPENAI_API_KEY — gpt-image-1 for background generation, gpt-4o-mini for storyboard/content ideas",
509	          "NEXT_PUBLIC_SUPABASE_URL — Supabase storage bucket public base URL",
510	          "SUPABASE_SERVICE_ROLE_KEY — admin uploads to content_posts table + storage bucket",
511	          "META_ACCESS_TOKEN — Graph API image/caption posts to IG + Facebook",
512	          "META_IG_USER_ID — Instagram Business account ID (auto-detected from page if connected)",
513	          "META_PAGE_ID — Facebook Page ID",
514	          "TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET — OAuth app credentials",
515	          "TIKTOK_ACCESS_TOKEN (stored in app_settings) — Direct video publish via TikTok Content Posting API",
516	          "TIKTOK_REFRESH_TOKEN (stored in app_settings) — 365-day refresh token, self-healing before publish",
517	          "MARK_VOICE_ID = 'nPczCjzI2devNBz1zQrb' — ElevenLabs custom voice for all Mark voiceovers",
518	          "FAL_KEY (optional) — Routes to fal-ai/kling-video for true AI animation (image-to-video)",
519	          "RUNWAY_API_KEY (optional) — Alt provider for AI animation (not fully wired yet)",
520	          "REPLICATE_API_TOKEN (optional) — Alt provider for AI animation (not fully wired yet)",
521	          "Supabase Database — content_posts table (id, platform, type, hook, script, caption, hashtags, image_url, status, scheduled_for, source, created_at, etc.)",
522	          "app_settings table — studio_ad_ideas (daily cached concepts), TIKTOK_* tokens, other config"
523	        ],
524	        "gaps": [
525	          "Studio-generated videos NOT auto-wired to content_posts: Users record MP4/WebM locally, must manually upload to Supabase via the /api/content/video endpoint and then supply publicUrl to /api/tiktok/publish. No one-click \"record video → attach to content post → publish to Meta/TikTok\" workflow. Meta video posting (Reels) is commented as 'not implemented' in publish.ts line 92 ('Reel needs a video file we don't generate').",
526	          "No Reel/video publishing to Meta: publish.ts only posts images to IG/FB. Reels require separate /graph/{igUserId}/media endpoint + (image OR video_url). Studio-generated MP4s cannot auto-publish to Instagram Reels without wiring that pathway.",
527	          "Studio batch export is download-only: Batch renders N videos to browser downloads (or .webm if not Chrome). No option to auto-upload each variant to Supabase and queue them as content_posts rows for bulk publishing.",
528	          "Ad Factory ideas → Studio → publish workflow requires manual copy-paste: Ideas are cached in app_settings, user clicks to load concept into Studio editor, records/exports manually, must then upload to Supabase and publish separately. No automated throughput from ideation → export → publish.",
529	          "No scheduled posting: content_posts has scheduled_for field but no scheduler checks it. Auto-publish only runs once per cron cycle; queued posts stay queued indefinitely until manually approved.",
530	          "TikTok draft/inbox flow stubbed: tiktok.ts has video.upload scope but no client endpoint to POST a video to draft/inbox (only direct public post). Users cannot save drafts to TikTok for final review.",
531	          "AI video animation (FAL/Runway/Replicate) only partially wired: /api/studio/aivideo accepts prompts but only FAL is implemented; queuing is non-blocking (no polling for result). No callback/webhook to download final video once render completes.",
532	          "No video-to-video remix: Studio can export 9:16 video, but no option to apply trending audio, add music bed, or re-edit once recorded. Music synthesis exists (line 363–368 in page.tsx) but no UI to control it.",
533	          "Content quality QA absent: No review board, flagging, or compliance audit before auto-publish. Auto-cron posts one image daily with zero human oversight.",
534	          "Multi-language/localization not present: All templates, prompts, and output are English-only. No way to generate Spanish/French variants for different markets.",
535	          "No attribution/UTM tracking on Studio exports: Generated images/videos have no embedded tracking pixels or UTM parameters in the CTA button. No way to attribute viewers back to source (organic vs. paid, which platform, etc.).",
536	          "Database schema for content_posts not visible in migration files: Exact column list, constraints, and indices are unstated. Assumed structure is { id, platform, type, hook, script, caption, hashtags, image_url, status, scheduled_for, source, created_at } but needs verification."
537	        ],
538	        "codeSnippets": [
539	          "// Generate a branded image for auto-content (with Mark mascot badge overlay)\nconst image_url = await generateImage();\n// Returns: https://{SUPABASE_URL}/storage/v1/object/public/content/auto/{timestamp}.jpg\n// Image includes Mark badge composited via Sharp on bottom-right",
540	          "// Publish image post to Meta (IG + Facebook)\nawait publishPost({ caption, hashtags, image_url });\n// Appends SOCIAL_DISCLOSURE automatically\n// Meta Graph API v21.0 IG: POST /media → poll status → POST /media_publish\n// Meta Graph API v21.0 FB: POST /photos with { url, caption }",
541	          "// Record Mark video with voiceover + captions synced\nconst { blob, ext } = await recordOne(scene);\n// Calls ElevenLabs TTS with MARK_VOICE_ID\n// Animates canvas 30fps, syncs captions chunk-by-chunk\n// Returns MP4 or WebM blob ready to download or upload",
542	          "// Create signed Supabase upload URL for video (bypass Vercel 4.5MB limit)\nconst { signedUrl, publicUrl } = await fetch('/api/content/video', { method: 'POST', body: JSON.stringify({ filename }) }).then(r => r.json());\n// Browser PUT's video blob directly to signedUrl\n// Later, pass publicUrl to TikTok publish",
543	          "// Publish video to TikTok via public URL\nawait tiktokPublishVideo(publicUrl, caption);\n// Appends SOCIAL_DISCLOSURE\n// TikTok init → upload → publish flow\n// Auto-selects privacy (PUBLIC_TO_EVERYONE if approved, SELF_ONLY if pending audit)",
544	          "// Generate fresh ad concepts in Mark's voice\nconst concepts = await generateAdConcepts(6);\n// Returns: [{ product, headline, sub, cta, hooks: [3], line, prompt }]\n// Each concept auto-ends with MARK_SIGNOFF\n// Cached daily in app_settings.studio_ad_ideas",
545	          "// Generate multi-scene storyboard\nconst sb = await generateStoryboard('DSCR loans');\n// Returns: { title, product, beats: [{ kind, vo, caption, bigText?, bgPrompt }] }\n// kind: 'hook' | 'teach' | 'cta'\n// Last beat.vo enforces MARK_COMPANY_SIGNOFF",
546	          "// Brand an image with Mark mascot (lib/content.ts)\nconst branded = await brandWithCedi(jpegBuffer);\n// Uses Sharp to composite CEDI_BADGE_B64 (base64 PNG) on bottom-right\n// Returns branded JPEG buffer, ready to upload to Supabase",
547	          "// Daily content generation cron (auto-publishes one post)\nawait generateBatch();\n// Generates 3 reel scripts + 1 image post\n// One image post auto-publishes to Meta if token configured\n// Rest stay queued for manual Approve & Publish"
548	        ]
549	      }
550	    ]
551	  }


===== line 84 | user =====
1	import Link from "next/link";
2	import {
3	  Home as HomeIcon, RefreshCw, Building2, TrendingUp, Zap, Briefcase, Landmark,
4	  CheckCircle2, ArrowRight, ShieldCheck, Headphones, Sparkles, BadgeCheck, Lock,
5	  Scale, Rocket, Award, HeartHandshake, X,
6	} from "lucide-react";
7	import { LICENSING_NOTE } from "@/lib/legal";
8	import { CediBubble } from "@/components/CediBubble";
9	import { CediVoice } from "@/components/CediVoice";
10	import HeroCapture from "@/components/HeroCapture";
11	
12	export const metadata = {
13	  title: "Fetti Financial Services LLC | Home, Investment & Business Lending",
14	  description:
15	    "Fetti Financial Services LLC — your mortgage solutions specialist (NMLS #2267023). We fund loans directly and tap dozens of lenders to solve your home, investment, or business financing fast. Pre-qualify in 2 minutes, no credit impact.",
16	  alternates: { canonical: "https://fettifi.com" },
17	};
18	
19	const FEATURED_STATE = "florida"; // licensed for every program; each page funnels to apply
20	
21	const CATEGORIES = [
22	  {
23	    title: "Home Loans",
24	    tag: "Owner-occupied · FL, MI, CA",
25	    blurb: "Buy or refinance the home you live in. Conventional, FHA & VA.",
26	    items: [
27	      { icon: HomeIcon, name: "Home Purchase", desc: "Conventional, FHA & VA options for primary residences.", slug: "home-purchase-loans" },
28	      { icon: RefreshCw, name: "Refinance & Cash-Out", desc: "Lower your rate or tap the equity in your home.", slug: "refinance-loans" },
29	    ],
30	  },
31	  {
32	    title: "Investment Loans",
33	    tag: "All 50 states",
34	    blurb: "Financing engineered for serious real-estate investors.",
35	    items: [
36	      { icon: Building2, name: "DSCR Rental Loans", desc: "Qualify on the property's cash flow. No W-2 or tax returns.", slug: "dscr-loans" },
37	      { icon: TrendingUp, name: "Fix & Flip", desc: "Purchase + rehab capital to move fast on deals.", slug: "fix-and-flip-loans" },
38	      { icon: Zap, name: "Bridge / Hard Money", desc: "Close in days when timing is everything.", slug: "hard-money-loans" },
39	    ],
40	  },
41	  {
42	    title: "Business Loans",
43	    tag: "All 50 states",
44	    blurb: "Capital to start, run, and scale your business.",
45	    items: [
46	      { icon: Briefcase, name: "Working Capital & Term Loans", desc: "Flexible funding for operations and growth.", slug: "business-loans" },
47	      { icon: Landmark, name: "Commercial Real Estate & SBA", desc: "Owner-user, investment CRE, and SBA programs.", slug: "commercial-real-estate-loans" },
48	    ],
49	  },
50	];
51	
52	const STATS = [
53	  { value: "Dozens", label: "Of lenders shopped for you" },
54	  { value: "All 50", label: "States. Investment & business" },
55	  { value: "FL · MI · CA", label: "Licensed home loans" },
56	  { value: "2 min", label: "To pre-qualify · no credit pull" },
57	];
58	
59	// The bank-vs-broker contrast. The core differentiator vs Chase / BofA / Wells / Rocket.
60	const BANK_VS = [
61	  { them: "Sells you one menu. Their own products", us: "Lends direct or shops a wide network. Your best fit wins" },
62	  { them: "Works for the bank's shareholders", us: "Works for you. We win when you do" },
63	  { them: "Branch hours, hold music, hand-offs", us: "One specialist, your phone, California-fast" },
64	  { them: "Take-it-or-leave-it on rate & terms", us: "Programs matched to your exact scenario" },
65	];
66	
67	const AUDIENCE = [
68	  { icon: HomeIcon, title: "Homebuyers & families", desc: "First-time or move-up. We make the biggest purchase of your life feel handled." },
69	  { icon: TrendingUp, title: "Real-estate investors", desc: "DSCR, flips, bridge, BRRRR. Financing built to scale a portfolio, not slow it down." },
70	  { icon: Briefcase, title: "Self-employed & 1099", desc: "Bank statements over tax returns. We speak entrepreneur because we are one." },
71	  { icon: Landmark, title: "Business owners", desc: "Working capital, CRE, SBA. Capital to start, run, and grow." },
72	];
73	
74	const STEPS = [
75	  { n: "01", icon: Sparkles, title: "Tell us your goal", desc: "Two-minute pre-qualification. Purchase, refinance, investment, or business. No credit pull to start." },
76	  { n: "02", icon: Headphones, title: "A specialist reaches out", desc: "A real loan expert reviews your scenario, shops the market, and maps the path to approval." },
77	  { n: "03", icon: BadgeCheck, title: "Get funded", desc: "We move fast, keep you updated at every step, and get you to the closing table." },
78	];
79	
80	const WHY = [
81	  { icon: ShieldCheck, title: "Compliance in our DNA", desc: "Shaped by years in heavily-regulated industries. We do it right. Every file, every time." },
82	  { icon: Rocket, title: "California-fast", desc: "Bridge and hard-money options close in days. Pre-qualification takes minutes." },
83	  { icon: Scale, title: "We work for you", desc: "Your solutions specialist. Our job is your best option, not a bank's quota." },
84	  { icon: HeartHandshake, title: "We get you", desc: "Built by people who've been the operator and the everyday grinder. We respect what you need." },
85	];
86	
87	const FAQ = [
88	  { q: "What makes Fetti different?", a: "We're your mortgage solutions specialist — and we're licensed as both a lender and a broker (NMLS #2267023). When funding your loan ourselves is the fastest, cleanest path, we do it. When a wide lender network gets you a better fit, we tap it. Either way you get the right solution — we do the legwork." },
89	  { q: "Will getting started affect my credit?", a: "No. Pre-qualifying takes about two minutes with no hard credit pull. We only move forward when you're ready." },
90	  { q: "How fast can I close?", a: "It depends on the loan, but we move fast. Bridge and hard-money options can close in days, and we keep you posted at every step. All loans are subject to credit approval and program guidelines." },
91	  { q: "What states do you cover?", a: "Owner-occupied home loans in Florida, Michigan, and California. Investment and business-purpose loans (DSCR, fix & flip, bridge, hard money, and business loans) are available in all 50 states." },
92	  { q: "What do I need to start?", a: "Just a couple minutes and a few basics about your goal. No documents required to pre-qualify. A specialist tells you exactly what's needed for your scenario." },
93	  { q: "Is it really no-obligation?", a: "100%. Pre-qualifying costs nothing, doesn't impact your credit, and comes with zero pressure. Wise money moves only. 🦉" },
94	];
95	
96	export default function MarketingHome() {
97	  return (
98	    <div className="min-h-screen bg-white text-slate-900 antialiased selection:bg-emerald-200">
99	      {/* ---------- Sticky header ---------- */}
100	      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
101	        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
102	          <Link href="/home" className="flex items-center gap-2.5">
103	            <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={36} height={36} className="w-9 h-9" />
104	            <span className="text-lg font-extrabold tracking-tight text-slate-900">Fetti<span className="text-emerald-600"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></span>
105	          </Link>
106	          <nav className="flex items-center gap-2 sm:gap-5 text-sm">
107	            <Link href="/lending" className="text-slate-600 hover:text-slate-900 transition hidden md:inline">Programs</Link>
108	            <Link href="/quote" className="text-slate-600 hover:text-slate-900 transition hidden sm:inline">Instant Quote</Link>
109	            <Link href="/apply/form" className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-full transition shadow-sm shadow-emerald-600/20">Apply</Link>
110	          </nav>
111	        </div>
112	      </header>
113	
114	      {/* ---------- Hero ---------- */}
115	      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50/60 to-white">
116	        <div aria-hidden className="absolute inset-0 -z-10">
117	          <div className="absolute top-[-12%] left-1/2 -translate-x-1/2 h-[440px] w-[820px] rounded-full bg-emerald-200/50 blur-[150px]" />
118	          <div className="absolute inset-0 opacity-[0.5]" style={{ backgroundImage: "linear-gradient(rgba(15,23,42,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.035) 1px, transparent 1px)", backgroundSize: "56px 56px", maskImage: "radial-gradient(ellipse 60% 50% at 50% 0%, #000 55%, transparent 100%)" }} />
119	        </div>
120	
121	        <div className="max-w-5xl mx-auto px-6 pt-20 pb-20 text-center">
122	          <img src="/fetti-logo.png" alt="Fetti Financial Services LLC" width={320} height={293} className="w-56 sm:w-72 lg:w-80 mx-auto mb-6 drop-shadow-sm" />
123	          <p className="mb-6 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
124	            We <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">DO</span> Money<span className="text-emerald-600">!</span>
125	          </p>
126	          <h1 className="mt-7 text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] text-slate-900">
127	            The loan the banks{" "}
128	            <span className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 bg-clip-text text-transparent">won&apos;t shop for you.</span>
129	          </h1>
130	          <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
131	            We&apos;re your <span className="font-semibold text-slate-800">mortgage solutions specialist</span>. So you bring the goal and we handle the rest: funding it ourselves when that&apos;s fastest, or tapping dozens of lenders when that fits better. Either way, we find your best option for home, investment, and business loans. Start in two minutes. No credit impact.
132	          </p>
133	          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
134	            <Link href="/apply/form" className="group inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-full text-lg transition shadow-xl shadow-emerald-600/25">
135	              Get pre-qualified <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition" />
136	            </Link>
137	            <Link href="/quote" className="inline-flex items-center justify-center border border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 text-slate-800 px-8 py-4 rounded-full text-lg transition">
138	              See what you qualify for
139	            </Link>
140	          </div>
141	
142	          {/* Inline capture — convert hero traffic on the spot instead of bouncing to /apply */}
143	          <HeroCapture />
144	          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
145	            <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-emerald-600" /> No credit impact to start</span>
146	            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> No obligation, no pressure</span>
147	            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Equal Housing Opportunity</span>
148	          </div>
149	          <CediBubble center size={64} className="mt-10">
150	            I&apos;m <span className="font-bold text-slate-900">Mark</span> with Fetti Financial Services, your mortgage solutions specialist. My job is simple: read your situation, find your smartest move, and make the whole thing easy. Tell me your goal below and I&apos;ll show you the way there. Two minutes, no credit pull.
151	          </CediBubble>
152	          <div className="mt-4 flex justify-center"><CediVoice /></div>
153	        </div>
154	
155	        {/* stats bar */}
156	        <div className="max-w-6xl mx-auto px-6 pb-16">
157	          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm">
158	            {STATS.map((s) => (
159	              <div key={s.label} className="bg-white px-6 py-6 text-center">
160	                <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600">{s.value}</div>
161	                <div className="mt-1 text-xs sm:text-sm text-slate-500">{s.label}</div>
162	              </div>
163	            ))}
164	          </div>
165	        </div>
166	      </section>
167	
168	      {/* ---------- Bank vs Broker ---------- */}
169	      <section className="max-w-6xl mx-auto px-6 py-20">
170	        <div className="text-center max-w-2xl mx-auto mb-12">
171	          <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-3">The Fetti advantage</p>
172	          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">A bank shows you one option. We find your best one.</h2>
173	          <p className="text-slate-500 mt-3">Big banks only push their own loans. We find what actually fits — funding directly when that&apos;s fastest, and shopping the whole market when that gets you a better deal.</p>
174	        </div>
175	        <div className="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
176	          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-7">
177	            <div className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-4">A big bank</div>
178	            <ul className="space-y-3">
179	              {BANK_VS.map((r) => (
180	                <li key={r.them} className="flex items-start gap-3 text-slate-500">
181	                  <X className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" /><span>{r.them}</span>
182	                </li>
183	              ))}
184	            </ul>
185	          </div>
186	          <div className="rounded-2xl border-2 border-emerald-300 bg-white p-7 shadow-lg shadow-emerald-600/5 relative">
187	            <span className="absolute -top-3 left-7 rounded-full bg-emerald-600 text-white text-xs font-bold px-3 py-1 shadow">Fetti</span>
188	            <div className="text-sm font-bold text-emerald-600 uppercase tracking-wide mb-4">Fetti. Solutions specialist</div>
189	            <ul className="space-y-3">
190	              {BANK_VS.map((r) => (
191	                <li key={r.us} className="flex items-start gap-3 text-slate-800">
192	                  <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" /><span>{r.us}</span>
193	                </li>
194	              ))}
195	            </ul>
196	          </div>
197	        </div>
198	      </section>
199	
200	      {/* ---------- Programs ---------- */}
201	      <section className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-100">
202	        <div className="text-center max-w-2xl mx-auto mb-12">
203	          <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-4">Lending programs</p>
204	          <CediBubble center className="mb-5">Whatever the move, I&apos;ve got a play for it. Pick yours. 🦉</CediBubble>
205	          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Financing for every objective</h2>
206	          <p className="text-slate-500 mt-3">Tap any program to see details. Every page leads straight to a fast pre-qualification.</p>
207	        </div>
208	        <div className="space-y-12">
209	          {CATEGORIES.map((cat) => (
210	            <div key={cat.title}>
211	              <div className="flex flex-wrap items-baseline gap-3 mb-1">
212	                <h3 className="text-2xl font-bold text-slate-900">{cat.title}</h3>
213	                <span className="text-xs text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-full px-2.5 py-0.5">{cat.tag}</span>
214	              </div>
215	              <p className="text-slate-500 text-sm mb-5">{cat.blurb}</p>
216	              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
217	                {cat.items.map((p) => (
218	                  <Link key={p.name} href={`/lending/${p.slug}-${FEATURED_STATE}`}
219	                    className="group relative block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-600/5 hover:-translate-y-0.5">
220	                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100 mb-4 group-hover:bg-emerald-100 transition">
221	                      <p.icon className="w-5 h-5 text-emerald-600" />
222	                    </div>
223	                    <h4 className="font-bold text-slate-900 flex items-center justify-between">{p.name}<ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition" /></h4>
224	                    <p className="text-slate-500 mt-1.5 text-sm leading-relaxed">{p.desc}</p>
225	                    <span className="mt-4 inline-block text-emerald-600 text-xs font-semibold opacity-0 group-hover:opacity-100 transition">Learn more →</span>
226	                  </Link>
227	                ))}
228	              </div>
229	            </div>
230	          ))}
231	        </div>
232	      </section>
233	
234	      {/* ---------- Built for you (audience) ---------- */}
235	      <section className="bg-slate-50 border-y border-slate-200 py-20">
236	        <div className="max-w-6xl mx-auto px-6">
237	          <div className="text-center max-w-2xl mx-auto mb-12">
238	            <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-3">Built for how you actually earn</p>
239	            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Whether you punch a clock or sign the checks</h2>
240	          </div>
241	          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
242	            {AUDIENCE.map((a) => (
243	              <div key={a.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
244	                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100 mb-4">
245	                  <a.icon className="w-5 h-5 text-emerald-600" />
246	                </div>
247	                <h3 className="font-bold text-slate-900">{a.title}</h3>
248	                <p className="text-slate-500 mt-1.5 text-sm leading-relaxed">{a.desc}</p>
249	              </div>
250	            ))}
251	          </div>
252	        </div>
253	      </section>
254	
255	      {/* ---------- Founder / authority ---------- */}
256	      <section className="max-w-5xl mx-auto px-6 py-20">
257	        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-8 sm:p-12 shadow-sm">
258	          <div className="flex items-center gap-2 text-emerald-600 font-mono text-xs uppercase tracking-widest mb-5">
259	            <Award className="w-4 h-4" /> Experience-led
260	          </div>
261	          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
262	            Built by people who&apos;ve been there.
263	          </h2>
264	          <p className="text-slate-600 mt-5 text-lg leading-relaxed max-w-3xl">
265	            We&apos;ve spent years helping build and scale companies. From a billion-dollar energy enterprise to
266	            businesses that went public. In some of the most heavily-regulated industries around. The lesson that
267	            stuck: do right by people, and do it by the book. So compliance and discipline aren&apos;t talking
268	            points here. They&apos;re just how we work.
269	          </p>
270	          <p className="text-slate-600 mt-4 text-lg leading-relaxed max-w-3xl">
271	            And having been on both sides. The entrepreneur chasing the next deal and the everyday grind toward a
272	            home. We get what you actually need: straight answers, real speed, and no games.
273	          </p>
274	          <p className="mt-6 font-semibold text-slate-700">Decades of combined experience. One standard: do it right.</p>
275	          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
276	            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Compliance-first by design</span>
277	            <span className="inline-flex items-center gap-1.5"><Scale className="w-4 h-4 text-emerald-600" /> Your side of the table</span>
278	            <span className="inline-flex items-center gap-1.5"><Award className="w-4 h-4 text-emerald-600" /> Hands-on, not corporate</span>
279	          </div>
280	        </div>
281	      </section>
282	
283	      {/* ---------- How it works ---------- */}
284	      <section className="relative py-20 border-y border-slate-200 bg-slate-50">
285	        <div className="max-w-6xl mx-auto px-6">
286	          <div className="text-center max-w-2xl mx-auto mb-14">
287	            <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-4">How it works</p>
288	            <CediBubble center className="mb-5">Three steps and you&apos;re funded. Eyes open. I&apos;ll guide you, all day. 🌴</CediBubble>
289	            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">We take you from hello to funded</h2>
290	          </div>
291	          <div className="grid md:grid-cols-3 gap-6">
292	            {STEPS.map((s) => (
293	              <div key={s.n} className="relative rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
294	                <div className="flex items-center justify-between">
295	                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
296	                    <s.icon className="w-5 h-5 text-emerald-600" />
297	                  </div>
298	                  <span className="text-4xl font-extrabold text-slate-100">{s.n}</span>
299	                </div>
300	                <h3 className="mt-5 text-lg font-bold text-slate-900">{s.title}</h3>
301	                <p className="mt-2 text-slate-500 text-sm leading-relaxed">{s.desc}</p>
302	              </div>
303	            ))}
304	          </div>
305	        </div>
306	      </section>
307	
308	      {/* ---------- Why Fetti ---------- */}
309	      <section className="max-w-6xl mx-auto px-6 py-20">
310	        <div className="grid lg:grid-cols-2 gap-12 items-center">
311	          <div>
312	            <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-4">Why Fetti</p>
313	            <CediBubble className="mb-5">I don&apos;t miss. Here&apos;s why folks roll with Fetti. Straight from me. 🦉</CediBubble>
314	            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-slate-900">A solutions specialist that moves like a fintech, advises like a partner.</h2>
315	            <p className="text-slate-500 mt-4 leading-relaxed">
316	              Institutional-grade programs, operator-grade discipline, and a team that actually picks up the phone.
317	              We carry the load. Shopping, structuring, and guiding. So you get the right loan, closed fast, without the stress.
318	            </p>
319	            <Link href="/apply/form" className="mt-7 inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-7 py-3.5 rounded-full transition shadow-lg shadow-emerald-600/25">
320	              Start my application <ArrowRight className="w-4 h-4" />
321	            </Link>
322	          </div>
323	          <div className="grid sm:grid-cols-2 gap-4">
324	            {WHY.map((w) => (
325	              <div key={w.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
326	                <w.icon className="w-7 h-7 text-emerald-600 mb-3" />
327	                <h3 className="font-bold text-slate-900">{w.title}</h3>
328	                <p className="text-slate-500 mt-1.5 text-sm leading-relaxed">{w.desc}</p>
329	              </div>
330	            ))}
331	          </div>
332	        </div>
333	      </section>
334	
335	      {/* ---------- FAQ (objection handling) ---------- */}
336	      <section className="bg-slate-50 border-y border-slate-200 py-20">
337	        <div className="max-w-3xl mx-auto px-6">
338	          <div className="text-center mb-12">
339	            <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-3">Straight answers</p>
340	            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Questions? Mark&apos;s got you.</h2>
341	          </div>
342	          <div className="space-y-3">
343	            {FAQ.map((f) => (
344	              <details key={f.q} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm open:shadow-md transition">
345	                <summary className="flex cursor-pointer items-center justify-between font-semibold text-slate-900 list-none">
346	                  {f.q}
347	                  <span className="ml-4 shrink-0 text-emerald-600 transition group-open:rotate-45 text-2xl leading-none">+</span>
348	                </summary>
349	                <p className="mt-3 text-slate-600 text-sm leading-relaxed">{f.a}</p>
350	              </details>
351	            ))}
352	          </div>
353	        </div>
354	      </section>
355	
356	      {/* ---------- Final CTA ---------- */}
357	      <section className="relative overflow-hidden bg-gradient-to-b from-white to-emerald-50/70 border-t border-slate-200">
358	        <div aria-hidden className="absolute inset-0 -z-10">
359	          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[340px] w-[760px] rounded-full bg-emerald-200/50 blur-[140px]" />
360	        </div>
361	        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
362	          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">Ready to get funded?</h2>
363	          <p className="text-slate-600 mt-4 text-lg">You start; we take it from there. A specialist reaches out fast and handles the rest. No pressure, no credit impact to start.</p>
364	          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
365	            <Link href="/apply/form" className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-10 py-4 rounded-full text-lg transition shadow-xl shadow-emerald-600/25">
366	              Get pre-qualified <ArrowRight className="w-5 h-5" />
367	            </Link>
368	            <Link href="/quote" className="inline-flex items-center justify-center border border-slate-300 hover:border-emerald-400 hover:bg-white text-slate-800 px-10 py-4 rounded-full text-lg transition">
369	              Instant quote
370	            </Link>
371	          </div>
372	          <CediBubble center size={64} className="mt-12">Sun&apos;s out, money&apos;s out. Let&apos;s ride. 🏝️</CediBubble>
373	        </div>
374	      </section>
375	
376	      {/* ---------- Footer ---------- */}
377	      <footer className="border-t border-slate-200 bg-slate-50">
378	        <div className="max-w-7xl mx-auto px-6 py-12">
379	          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
380	            <div className="flex items-center gap-2.5">
381	              <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={32} height={32} className="w-8 h-8" />
382	              <div className="leading-tight">
383	                <span className="font-extrabold tracking-tight text-slate-900">Fetti<span className="text-emerald-600"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></span>
384	                <p className="text-xs font-bold text-emerald-600">We DO Money!</p>
385	              </div>
386	            </div>
387	            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
388	              <Link href="/lending" className="hover:text-slate-900 transition">Programs</Link>
389	              <Link href="/quote" className="hover:text-slate-900 transition">Instant Quote</Link>
390	              <Link href="/apply/form" className="hover:text-slate-900 transition">Apply</Link>
391	              <Link href="/privacy" className="hover:text-slate-900 transition">Privacy</Link>
392	              <Link href="/terms" className="hover:text-slate-900 transition">Terms</Link>
393	            </nav>
394	          </div>
395	          <div className="mt-8 pt-8 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
396	            <p className="mb-2">© {new Date().getFullYear()} Fetti Financial Services LLC · 5777 W Century Blvd, Suite 1435, Los Angeles, CA 90045 · info@fettifi.com</p>
397	            {LICENSING_NOTE}
398	          </div>
399	        </div>
400	      </footer>
401	    </div>
402	  );
403	}
404


===== line 2151 | user =====
############## lib/adFactory.ts ##############
     118 lib/adFactory.ts
// Ad Factory — auto-generates fresh INFORMATIONAL short-video concepts in Mark's
// voice (hook + teach-one-thing voiceover + on-screen copy + image direction).
// The creative ideation runs on a daily cron and on-demand; the final
// image/video render happens one-click in the Creative Studio (with Mark's
// voiceover via TTS). NMLS #2267023 disclosure is baked into every render.
import { MARK_PERSONA, MARK_INFORMATIONAL, MARK_COMPANY_SIGNOFF } from "@/lib/markPersona";

export type AdConcept = {
  product: string; headline: string; sub: string; cta: string;
  hooks: string[]; line: string; prompt: string;
};

// A storyboard for a multi-scene ANIMATED cartoon short: each beat is its own
// illustrated cartoon scene with Mark's spoken line, an on-screen caption, an
// optional punchy "bigText" to animate, and a cartoon-scene image prompt.
export type StoryBeat = { kind: "hook" | "teach" | "cta"; vo: string; caption: string; bigText?: string; bgPrompt: string };
export type Storyboard = { title: string; product: string; beats: StoryBeat[] };

export async function generateStoryboard(topic = "", nBeats = 5): Promise<Storyboard | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const n = Math.min(Math.max(nBeats, 3), 7);
  const sys = `${MARK_PERSONA}

${MARK_INFORMATIONAL}

You are storyboarding a SHORT, FUN, EDUCATIONAL animated cartoon (9:16 vertical, ~25-40 seconds) starring MARK the golden owl. It must be genuinely entertaining to watch AND teach one real mortgage concept so the viewer wants to apply. Think top-tier fintech "explainer short": a scroll-stopping hook, 2-3 quick teaching beats with a vivid cartoon scene each, then a direct call to apply.

Return STRICT JSON: {"title": "...", "product": "...", "beats": [ ... ]} with EXACTLY ${n} beats.
- beats[0].kind = "hook"; the last beat.kind = "cta"; the middle beats.kind = "teach".
Each beat object:
- kind: "hook" | "teach" | "cta"
- vo: Mark's first-person spoken line for THIS scene only (1-2 short sentences, ~3-7 seconds spoken). Conversational, energetic, accurate.
- caption: <= 6 words, the on-screen kinetic text for this scene (punchy).
- bigText: OPTIONAL short punchy number/phrase to animate big on screen (e.g. "0% income docs", "1.0 DSCR", "2 min"). Omit if not useful.
- bgPrompt: a CARTOON SCENE illustration description for THIS beat — vibrant flat-vector cartoon, bold clean outlines, bright colors, depicting the concept (e.g. "a cheerful cartoon rental house with green dollar arrows flowing in", "a cartoon bank vault opening", "a happy cartoon investor holding keys"). NO text, NO words, NO logos in the image.

Rules: the LAST beat's vo MUST end with "${MARK_COMPANY_SIGNOFF}" and its caption MUST be a direct apply CTA (e.g. "Apply in 2 minutes"). Teach accurately; compliant (NO rate or approval promises, no guarantees); Mark says "we've got the money"/"we fund it", NEVER "find your money". Topic focus: ${topic || "pick one high-interest mortgage topic (DSCR, bank-statement, fix & flip, cash-out refi, first-time buyer myths)"}.`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        temperature: 0.85,
        messages: [{ role: "system", content: sys }, { role: "user", content: `Storyboard one ${n}-beat animated Mark short as JSON now${topic ? ` about: ${topic}` : ""}.` }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    let beats: StoryBeat[] = Array.isArray(parsed.beats) ? parsed.beats : [];
    beats = beats.slice(0, n).map((bt: any, i: number) => ({
      kind: (i === 0 ? "hook" : i === beats.length - 1 ? "cta" : "teach") as StoryBeat["kind"],
      vo: String(bt.vo || "").slice(0, 320),
      caption: String(bt.caption || "").slice(0, 60),
      bigText: bt.bigText ? String(bt.bigText).slice(0, 28) : undefined,
      bgPrompt: String(bt.bgPrompt || "vibrant flat-vector cartoon scene of a friendly neighborhood house, bright colors").slice(0, 240),
    })).filter((bt) => bt.vo && bt.caption);
    if (beats.length < 3) return null;
    // enforce the company sign-off on the final spoken line
    const last = beats[beats.length - 1];
    last.vo = `${last.vo.replace(/\s*Fetti[^.!?]*we do money[.!?]*\s*$/i, "").trim()} ${MARK_COMPANY_SIGNOFF}`.trim();
    return { title: String(parsed.title || topic || "Mark Short").slice(0, 80), product: String(parsed.product || topic || "Fetti Loan").slice(0, 48), beats };
  } catch {
    return null;
  }
}

export async function generateAdConcepts(n = 6): Promise<AdConcept[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return [];
  const sys = `${MARK_PERSONA}

${MARK_INFORMATIONAL}

You write short-form INFORMATIONAL-THAT-CONVERTS video concepts for Fetti: teach how to USE a product for the viewer's goal so they APPLY on the spot. Topics: how DSCR loans work, qualifying on rental income, no-tax-return options, fix & flip basics, refinance & cash-out, bank-statement loans for the self-employed, first-time-buyer myths, closing in an LLC. Fetti is a DIRECT LENDER (we HAVE the money) and also a broker.

Return STRICT JSON: {"concepts":[ ... ]}. Each concept object:
- product: short topic label (e.g. "DSCR, explained")
- headline: <= 5 words — the teaching point (Mark's on-screen line)
- sub: <= 12 words — the one-line takeaway shown on screen
- cta: <= 4 words — a DIRECT apply action (e.g. "Apply in 2 min", "Get pre-qualified", "Start your file")
- hooks: array of EXACTLY 3 curiosity openers tied to a goal, <= 6 words each (first-frame text, e.g. "No tax returns?")
- line: Mark's first-person voiceover, ~15-30 seconds spoken — teach how the product works AND how THEY'd use it for their situation, then a DIRECT call to apply now ("Tap the link and get pre-qualified today — no credit pull to start."); MUST end with "${MARK_COMPANY_SIGNOFF}"
- prompt: a real-estate/finance photo description for the AI background (photorealistic, bright; NO text, NO logos, NO words)

Rules: vary the topics across the ${n} concepts; teach accurately so the how-to is real; drive an application now (not "let's talk later"); compliant (NO rate or approval promises, no guarantees); Mark says "we've got the money"/"we fund it", NEVER "find your money".`;
  try {

############## lib/markPersona.ts (head) ##############
      41 lib/markPersona.ts
// MARK — the Fetti Financial Services spokesperson owl 🦉. One source of truth for
// his character so every ad, video script, and AI-written line stays in voice.
// Personality: COOL & INSIGHTFUL ADVISOR — calm, sharp, articulate; the wise guide
// in your corner. Not flashy, not street. Signature sign-off: "Fetti Financial Services, we do money!"

// Mark's trademark/signature sign-off — always closes with this exact line.
export const MARK_SIGNOFF = "Fetti Financial Services, we do money!";

// Mark's OWN ElevenLabs voice — DISTINCT from Rupee's custom voice
// (NBA1cQRTWFj793Oifdaj is Rupee; never use it for Mark). Calm, confident,
// insightful male. Used for the homepage greeting + Creative Studio voiceovers.
export const MARK_VOICE_ID = "nPczCjzI2devNBz1zQrb";

// Video outros use the same trademark signature. NMLS #2267023 is shown
// VISUALLY on every studio export (+ footer disclosures), so it's covered
// without saying the number aloud in the signature.
export const MARK_COMPANY_SIGNOFF = "Fetti Financial Services, we do money!";

// Tone block for INFORMATIONAL short-form videos (the default content style):
// teach one true, useful thing fast — Mark as the trusted licensed-company voice.
export const MARK_INFORMATIONAL = `CONTENT MODE — INFORMATIONAL THAT CONVERTS (15–30 seconds, Mark narrates):
Teach ONE Fetti product by showing the viewer HOW to USE it for their own goal — right now — so applying becomes the obvious next move. Educational and trustworthy, but it MUST drive an application today (never "let's talk later").
- Structure: (1) a curiosity hook tied to a real goal ("Want to buy a rental without showing tax returns?", "Self-employed and tired of getting denied?"), (2) explain how the product works in plain English AND how THEY would use it for their exact situation — the on-the-spot how-to, (3) make it feel doable immediately ("You can start this in about two minutes — no credit pull to begin"), (4) a DIRECT call to apply now ("Tap the link and get pre-qualified today."), (5) the company sign-off.
- Sound like a licensed company you can trust: composed, factual, confident, action-first. No hype, no emojis in the spoken script, no rate/approval promises, no guarantees.
- END the spoken script with exactly: "${MARK_COMPANY_SIGNOFF}"`;

// Drop this into any LLM prompt that writes Mark's copy to keep him in character.
export const MARK_PERSONA = `You are MARK — the Fetti Financial Services mascot, an owl and the face of the brand.
WHO MARK IS: A cool, insightful money guide. Wise like an owl, articulate and composed. He sees your best move and explains it simply, making people feel smart and handled — the sharp friend who happens to know money inside out.
VOICE: Cool, calm, and insightful. Quietly confident and articulate — never loud, never hyped: short, clean, declarative sentences in plain English, no jargon, no slang, no gimmicks. Never casual or street. Speaks to "you," first person ("we've got the money"). Reassuring, considered authority. Turns "I can't" into "here's how."
POSITIONING (critical): Fetti is a NONBANK MORTGAGE LENDER that GETS DEALS DONE — especially the loans big banks won't touch. We have our OWN capital and the capability to fund directly, and we're built for the borrowers banks turn away: self-employed, investors, unusual income, dinged credit, tough scenarios. Mark's message is CONFIDENCE + CAPABILITY, not comparison-shopping. He says: "we've got the money," "we fund it," "we do the loans other banks won't," "turned down by a bank? that's exactly who we're built for — we figure it out," "we're in your corner, working for you, not the bank." DE-EMPHASIZE shopping/comparing — do NOT say "we shop the market," "compare lenders," "find your best rate," or call Fetti "a lender and a broker" in marketing; that sounds like a broker and makes people doubt we have the money. We HAVE the money and the capability. NEVER say "we'll find the money" (we already have it). COMPLIANCE: confident capability is great, but NEVER guarantee approval or a specific rate — frame hard cases as "we figure it out / we find a path," never "we'll approve you."
DO: be direct, encouraging, specific, and real; make the borrower feel smart and handled.
DON'T: promise rates or approvals, guarantee outcomes, use industry jargon, or sound pushy. Stay compliant for a licensed lender (NMLS #2267023; this is an ad, not a commitment to lend).
ALWAYS close with: "${MARK_SIGNOFF}"`;

// Ensure a Mark voiceover/script ends with his sign-off (no duplicate).
export function withMarkSignoff(script: string): string {
  // strip any existing "Fetti … we do money" ending so we don't double it
  const s = script.trim().replace(/\s*Fetti[^.!?]*we do money[.!?]*\s*$/i, "").trim();
  return `${s} ${MARK_SIGNOFF}`;
}

############## app/studio/page.tsx — what it does (grep) ##############
     597 app/studio/page.tsx
3:// Fetti Creative Studio — in-CRM AI video ad engine with MARK as spokesperson +
6://  • burned-in CAPTIONS synced to Mark's voiceover (85% watch muted)
7://  • 9:16 default (Reels/Stories), fast zoom, Mark talking-bob
9://  • BATCH mode: one click renders N finished Mark video ads (fresh AI scripts →
10://    AI background → Mark voiceover → captioned 9:16 MP4), ready to A/B on Meta.
11:// Exports a branded PNG or an animated MP4/webm (canvas + MediaRecorder + WebAudio
14:import { Loader2, Sparkles, Download, Video, Upload, Image as ImageIcon, Film } from "lucide-react";
15:import { withMarkSignoff, MARK_VOICE_ID } from "@/lib/markPersona";
26:    line: "I'm Mark, with Fetti. Own a rental — or ready to? We qualify you on the property's income, not your tax returns. Close in your L-L-C, in any state. Two minutes to start, and the capital is ready when you are. Fetti. We do money.",
30:    line: "Mark here. You have equity sitting in your rentals — let's put it to work. We qualify on the property's cash flow, not your paperwork. Pull your cash out, fund the next deal. Start below. Fetti. We do money.",
34:    line: "Mark here. Found a flip? We fund the purchase and the rehab, close fast, and keep you interest-only through the project. You move quick — we move quicker. Let's fund it. Fetti. We do money.",
38:    line: "I'm Mark, with Fetti. Looking for a lower payment, or cash from your home? We're a nonbank lender — we fund it with our own money, including the refinances banks turn down. See your numbers in two minutes. Fetti. We do money.",
42:    line: "Mark here. Self-employed? Your tax returns rarely show what you truly earn — so we don't use them. We qualify you on your bank deposits instead. Built by entrepreneurs who understand. Start below. Fetti. We do money.",
46:function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
51:function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
55:// Split a voiceover script into short caption phrases (~5 words / clause).
56:function chunkScript(text: string): string[] {
64:type Scene = {
65:  bg: HTMLImageElement | null; emblem: HTMLImageElement | null; mark: HTMLImageElement | null;
67:  markMode: boolean; captions: boolean; voiceover: boolean;
69:type Anim = { zoom?: number; markIn?: number; bob?: number; caption?: string; hookBig?: number; videoMode?: boolean };
71:function drawScene(c: HTMLCanvasElement, F: { w: number; h: number }, scene: Scene, anim: Anim = {}) {
74:  const { bg, emblem, mark, headline, sub, cta, hook, markMode, captions } = scene;
75:  const { zoom = 1, markIn = 1, bob = 0, caption = "", hookBig = 0, videoMode = false } = anim;
77:  const tall = H / W > 1.6; // story (9:16) gets a slightly smaller Mark than 4:5 / 1:1
91:  // MARK spokesperson (bottom-right)
92:  if (markMode && mark) {
93:    const mh = H * (tall ? 0.52 : 0.6); const mw = mh * (mark.width / mark.height);
94:    const mx = W - mw - 10 * s; const my = H - mh + (1 - markIn) * mh * 0.5 + bob;
95:    ctx.globalAlpha = markIn; ctx.drawImage(mark, mx, my, mw, mh); ctx.globalAlpha = 1;
98:  // Speech bubble with headline — only in the static/image layout (not video)
99:  if (!videoMode && markMode) {
110:  if (!videoMode) { // static: sub
112:    if (sub) { ctx.fillStyle = "#e2e8f0"; ctx.font = `600 ${38 * s}px -apple-system, "Inter", Arial`; const sl = wrap(ctx, sub, (markMode ? W * 0.6 : W - 100 * s)); y -= sl.length * 48 * s; sl.forEach((l, i) => ctx.fillText(l, 50 * s, y + i * 48 * s)); }
114:  // CAPTIONS (video): big centered phrase, synced to the voiceover
115:  if (videoMode && captions && caption) {
130:  // BIG HOOK overlay (first ~1.8s of video) — the scroll-stopper
143:// ── Multi-scene ANIMATED production ──────────────────────────────────────────
144:// A storyboard = ordered cartoon scenes (beats). Each frame composites the current
145:// beat's AI cartoon scene (Ken Burns) crossfading from the previous, an animated
Shell cwd was reset to /Users/fetti/Desktop/Fetti Cap growth /fetti-capital-ai


===== line 2158 | user =====
360	          srcNode.connect(dest); srcNode.connect(ac.destination); tracks.push(...dest.stream.getAudioTracks());
361	          analyser = ac.createAnalyser(); analyser.fftSize = 256; srcNode.connect(analyser); adata = new Uint8Array(analyser.frequencyBinCount);
362	          // Subtle music bed (synthesized soft pad) mixed into the RECORDING only — not the live monitor.
363	          if (music) {
364	            try {
365	              const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 820;
366	              const mg = ac.createGain(); mg.gain.value = 0.045; lp.connect(mg); mg.connect(dest);
367	              [196.0, 261.63, 329.63].forEach((f) => { const o = ac!.createOscillator(); o.type = "sine"; o.frequency.value = f; const og = ac!.createGain(); og.gain.value = 0.34; o.connect(og); og.connect(lp); o.start(); });
368	            } catch { /* music is optional */ }
369	          }
370	        } else onStatus?.("⚠️ Voiceover failed — recording silent.");
371	        const weights = beats.map((b) => Math.max(8, b.vo.length)); const wsum = weights.reduce((a, b) => a + b, 0);
372	        const starts: number[] = []; let accW = 0; for (let i = 0; i < beats.length; i++) { starts.push((accW / wsum) * durMs); accW += weights[i]; }
373	        const endOf = (i: number) => (i < beats.length - 1 ? starts[i + 1] : durMs);
374	        const mime = pickMime(); const recr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
375	        const chunks: BlobPart[] = []; recr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
376	        recr.onstop = () => { const ext = mime.includes("mp4") ? "mp4" : "webm"; const blob = new Blob(chunks, { type: mime.split(";")[0] }); try { ac?.close(); } catch { /* */ } resolve({ blob, ext }); };
377	        const sc = F.w / 1080;
378	        onStatus?.("🎬 Animating Mark…"); recr.start(); const t0 = performance.now(); if (audioEl) { try { await audioEl.play(); } catch { /* */ } }
379	        const loop = (t: number) => {
380	          const ms = audioEl && !audioEl.paused && audioEl.currentTime > 0 ? audioEl.currentTime * 1000 : t - t0;
381	          const tt = Math.min(ms, durMs);
382	          let bi = 0; while (bi < beats.length - 1 && tt >= endOf(bi)) bi++;
383	          const bstart = starts[bi], blen = Math.max(1, endOf(bi) - bstart), bp = Math.min(1, (tt - bstart) / blen), localEl = (tt - bstart) / 1000;
384	          let talk = 0; if (analyser && adata) { analyser.getByteFrequencyData(adata); let sum = 0; for (let i = 0; i < adata.length; i++) sum += adata[i]; talk = Math.min(sum / adata.length / 110, 1); }
385	          const beat = beats[bi];
386	          drawProductionFrame(c, F, {
387	            bg: bgs[bi], prevBg: bi > 0 ? bgs[bi - 1] : null, trans: Math.min(localEl / 0.45, 1), kb: bp, drift: bi % 2 ? 1 : -1,
388	            emblem: embRef.current, mark: markRef.current, markIn: Math.min(tt / 600, 1), bob: Math.sin((tt / 1000) * 5) * 5 * sc, talk,
389	            caption: beat.caption, capReveal: Math.min(bp / 0.55, 1), bigText: beat.kind !== "cta" ? beat.bigText : undefined, bigIn: Math.min(localEl / 0.4, 1),
390	            isCta: beat.kind === "cta", cta: ctaLabel, progress: tt / durMs,
391	            pop: Math.max(0, 1 - localEl / 0.45), swayT: (tt / 1000) * 2,
392	          });
393	          if (tt < durMs && (!audioEl || !audioEl.ended)) requestAnimationFrame(loop); else setTimeout(() => recr.state !== "inactive" && recr.stop(), 250);
394	        };
395	        requestAnimationFrame(loop);
396	      } catch (err) { try { ac?.close(); } catch { /* */ } reject(err as Error); }
397	    });
398	  }
399	
400	  async function produceShort() {
401	    if (rec || batch.running || producing) return;
402	    setProducing(true); setMsg(null);
403	    try {
404	      setProdStatus("✍️ Storyboarding the short…");
405	      const r = await fetch("/api/studio/storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: prodTopic, beats: prodBeats }) });
406	      const j = await r.json();
407	      if (!r.ok || !j.storyboard) { setMsg(j.error || "Couldn't storyboard — check the OpenAI key."); return; }
408	      const sb: Storyboard = j.storyboard;
409	      const bgs: (HTMLImageElement | null)[] = [];
410	      for (let i = 0; i < sb.beats.length; i++) {
411	        setProdStatus(`🎨 Illustrating scene ${i + 1}/${sb.beats.length}…`);
412	        bgs.push(await genBgImage(`${sb.beats[i].bgPrompt}, vibrant flat-vector cartoon illustration, bold clean outlines, bright saturated colors, playful, NO text, no words, no logos`));
413	      }
414	      const { blob, ext } = await recordProduction(sb, bgs, setProdStatus);
415	      downloadBlob(blob, `fetti-mark-short-${slug(sb.product || prodTopic || "short")}.${ext}`);
416	      setMsg(ext === "webm" ? "✓ Animated short saved (.webm — use Chrome for .mp4)." : "✓ Animated Mark short saved (.mp4) — multi-scene, captioned, voiced.");
417	    } catch (e: any) { setMsg("⚠️ " + (e?.message || "Production failed. Try Chrome.")); } finally { setProducing(false); setProdStatus(""); }
418	  }
419	
420	  async function tryAiVideo() {
421	    setMsg(null);
422	    try {
423	      const r = await fetch("/api/studio/aivideo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: `Bring this cartoon scene to life: ${prodTopic || headline}. Gentle lively motion, the golden-owl character gestures naturally.` }) });
424	      const j = await r.json();
425	      setMsg(j.error || (j.status === "queued" ? "AI video queued with your provider — result polling will finish once your key is confirmed." : "AI video unavailable."));
426	    } catch { setMsg("⚠️ AI video request failed."); }
427	  }
428	
429	  async function downloadVideo() {
430	    setRec(true); setMsg(null);
431	    try {
432	      const { blob, ext } = await recordOne(editorScene(), setMsg);
433	      downloadBlob(blob, `fetti-mark-ad-${fmt}.${ext}`);
434	      setMsg(ext === "webm" ? "✓ Saved (.webm). Meta prefers .mp4 — use Chrome for that. The PNG always works too." : "✓ Mark's video saved (.mp4) — captions + voice, ready for Meta.");
435	    } catch { setMsg("⚠️ Your browser blocked recording. Use the PNG, or try Chrome."); } finally { setRec(false); }
436	  }
437	
438	  // BATCH: render N finished Mark video ads back-to-back. Fresh AI concepts (if the
439	  // idea queue is short) → AI background per variant → Mark voiceover → captioned
440	  // 9:16 MP4 → download. Sequential (one canvas/recorder at a time). A/B-ready.
441	  async function renderBatch() {
442	    if (rec || batch.running) return;
443	    setMsg(null);
444	    const n = Math.min(Math.max(batchN, 1), 8);
445	    let cs: any[] = ideas;
446	    if (cs.length < n) {
447	      setBatch({ running: true, done: 0, total: n, label: "Writing fresh Mark scripts…" });
448	      try {
449	        const r = await fetch("/api/studio/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: Math.max(n, 6) }) });
450	        const j = await r.json(); if (r.ok && j.concepts?.length) { cs = j.concepts; setIdeas(cs); }
451	      } catch { /* */ }
452	    }
453	    cs = (cs || []).slice(0, n);
454	    if (!cs.length) { setMsg("⚠️ Couldn't generate concepts — check OpenAI key, then retry."); setBatch({ running: false, done: 0, total: 0, label: "" }); return; }
455	    setBatch({ running: true, done: 0, total: cs.length, label: "" });
456	    let saved = 0; let lastExt = "mp4";
457	    for (let i = 0; i < cs.length; i++) {
458	      const c = cs[i];
459	      const head = c.headline || `Variant ${i + 1}`;
460	      setBatch({ running: true, done: i, total: cs.length, label: `Variant ${i + 1}/${cs.length}: ${head} — generating background…` });
461	      const bgImg = await genBgImage(c.prompt || prompt);
462	      const scene: Scene = {
463	        bg: bgImg, emblem: embRef.current, mark: markRef.current,
464	        headline: head, sub: c.sub || "", cta: c.cta || "Apply now",
465	        hook: (Array.isArray(c.hooks) && c.hooks[0]) || head, line: c.line || line,
466	        markMode: true, captions: true, voiceover: true,
467	      };
468	      try {
469	        const { blob, ext } = await recordOne(scene, (st) => setBatch((b) => ({ ...b, label: `Variant ${i + 1}/${cs.length}: ${head} — ${st}` })));
470	        lastExt = ext; downloadBlob(blob, `fetti-mark-${slug(c.product || head)}-${i + 1}.${ext}`); saved++;
471	      } catch { /* skip a failed variant, keep going */ }
472	      setBatch((b) => ({ ...b, done: i + 1 }));
473	    }
474	    setBatch({ running: false, done: cs.length, total: cs.length, label: "" });
475	    setMsg(saved
476	      ? `✓ Batch done — ${saved} Mark video ad${saved === 1 ? "" : "s"} saved${lastExt === "webm" ? " (.webm — use Chrome for .mp4)" : " (.mp4)"}. A/B test them on Meta.`
477	      : "⚠️ Batch finished but nothing saved — your browser may have blocked recording. Try Chrome.");
478	  }
479	
480	  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
481	  const working = rec || batch.running;
482	
483	  return (
484	    <div className="min-h-screen bg-slate-950 text-white p-6">
485	      <div className="max-w-6xl mx-auto">
486	        <h1 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-emerald-400" /> Creative Studio</h1>
487	        <p className="text-slate-400 text-sm mt-1">Mark-narrated informational short videos: a curiosity hook, one useful thing taught in plain English, captions synced to his voice, 9:16. Company NMLS #2267023 disclosure baked into every export.</p>
488	
489	        <div className="flex flex-wrap gap-2 mt-4">{TEMPLATES.map((t) => (<button key={t.key} onClick={() => applyTemplate(t)} className="text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200">{t.key}</button>))}</div>
490	
491	        {/* Ad Factory — auto-generated fresh ideas (daily cron + on-demand) */}
492	        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 mt-4">
493	          <div className="flex items-center justify-between gap-3">
494	            <div className="text-sm font-semibold flex items-center gap-2">🤖 Ad Factory <span className="text-xs text-slate-500 font-normal hidden sm:inline">— fresh AI ad ideas in Mark&apos;s voice, auto-refreshed daily</span></div>
495	            <button onClick={autoIdeas} disabled={loadingIdeas} className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5">{loadingIdeas ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{loadingIdeas ? "Thinking…" : "Generate ideas"}</button>
496	          </div>
497	          {ideas.length > 0 ? (
498	            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
499	              {ideas.map((c, i) => (
500	                <button key={i} onClick={() => applyConcept(c)} className="text-left bg-slate-900 border border-slate-800 hover:border-emerald-500/60 rounded-lg p-3">
501	                  <div className="text-[10px] uppercase tracking-wide text-emerald-400">{c.product}</div>
502	                  <div className="text-sm font-semibold mt-0.5 truncate">{(c.hooks && c.hooks[0]) || c.headline}</div>
503	                  <div className="text-xs text-slate-500 mt-1 h-8 overflow-hidden">{(c.line || "").slice(0, 95)}…</div>
504	                </button>
505	              ))}
506	            </div>
507	          ) : (
508	            <div className="text-xs text-slate-600 mt-2">Click <b>Generate ideas</b> for a fresh batch (they also auto-refresh daily). Tap any idea to load its hooks, script &amp; copy into the editor — then Generate the image and export.</div>
509	          )}
510	        </div>
511	
512	        {/* Batch Engine — one click renders N finished Mark video ads for A/B testing */}
513	        <div className="bg-gradient-to-r from-emerald-950/50 to-slate-900/40 border border-emerald-800/40 rounded-xl p-4 mt-4">
514	          <div className="flex flex-wrap items-center justify-between gap-3">
515	            <div className="text-sm font-semibold flex items-center gap-2"><Film className="w-4 h-4 text-emerald-400" /> Batch Engine
516	              <span className="text-xs text-slate-500 font-normal hidden sm:inline">— one click → multiple finished Mark video ads (script → voice → captioned 9:16), A/B-ready</span></div>
517	            <div className="flex items-center gap-2">
518	              <label className="text-xs text-slate-400">Variants</label>
519	              <input type="number" min={1} max={8} value={batchN} onChange={(e) => setBatchN(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} disabled={working} className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white disabled:opacity-50" />
520	              <button onClick={renderBatch} disabled={working} className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5">{batch.running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}{batch.running ? "Rendering…" : `Make ${batchN} video ad${batchN === 1 ? "" : "s"}`}</button>
521	            </div>
522	          </div>
523	          {batch.running ? (
524	            <div className="mt-3">
525	              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 5}%` }} /></div>
526	              <div className="text-xs text-emerald-300/80 mt-2">{batch.label || `Rendered ${batch.done}/${batch.total}…`} <span className="text-slate-500">— keep this tab focused; each clip records in real time.</span></div>
527	            </div>
528	          ) : (
529	            <div className="text-xs text-slate-600 mt-2">Uses your Ad Factory ideas (or writes fresh ones), then auto-generates a background, Mark&apos;s voiceover &amp; captions for each — and downloads every finished <b>9:16 .mp4</b>. Toggles below are forced on for the batch. Records in real time, so {batchN} clips take a few minutes.</div>
530	          )}
531	        </div>
532	
533	        {/* Animated Short Studio — multi-scene cartoon production with Mark */}
534	        <div className="bg-gradient-to-r from-indigo-950/50 to-slate-900/40 border border-indigo-800/40 rounded-xl p-4 mt-4">
535	          <div className="text-sm font-semibold flex items-center gap-2"><Film className="w-4 h-4 text-indigo-300" /> Animated Short Studio
536	            <span className="text-xs text-slate-500 font-normal hidden sm:inline">— a real multi-scene cartoon production: storyboard → a cartoon scene per beat → animated Mark + kinetic captions → 9:16 .mp4</span></div>
537	          <div className="flex flex-wrap items-end gap-2 mt-3">
538	            <div className="flex-1 min-w-[200px]"><label className="text-xs text-slate-500">Topic (optional — leave blank for a fresh pick)</label>
539	              <input value={prodTopic} onChange={(e) => setProdTopic(e.target.value)} placeholder="e.g. how DSCR loans qualify on the rent" disabled={producing} className={inp} /></div>
540	            <div><label className="text-xs text-slate-500">Scenes</label>
541	              <input type="number" min={3} max={7} value={prodBeats} onChange={(e) => setProdBeats(Math.min(7, Math.max(3, Number(e.target.value) || 5)))} disabled={producing} className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-white disabled:opacity-50" /></div>
542	            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer pb-2"><input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} disabled={producing} className="accent-emerald-500" /> 🎵 Music</label>
543	            <button onClick={produceShort} disabled={producing || working} className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">{producing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}{producing ? "Producing…" : "Produce animated short"}</button>
544	            <button onClick={tryAiVideo} disabled={producing} title={aivid.available ? `True AI animation via ${aivid.provider}` : "Add a video API key (FAL_KEY / Runway) to enable true AI animation"} className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${aivid.available ? "bg-fuchsia-600 hover:bg-fuchsia-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}><Sparkles className="w-4 h-4" /> {aivid.available ? "AI Video" : "AI Video (add key)"}</button>
545	          </div>
546	          {producing
547	            ? <div className="text-xs text-indigo-300/90 mt-2">{prodStatus || "Working…"} <span className="text-slate-500">— keep this tab focused; it records in real time.</span></div>
548	            : <div className="text-xs text-slate-600 mt-2">Writes a hook → teach → CTA storyboard, illustrates a unique cartoon scene per beat, then animates Mark (entrance, motion, talks to his voiceover) with scene transitions, Ken-Burns motion &amp; word-by-word captions. Uses the Format + Mark voice below. Best in Chrome (.mp4).</div>}
549	        </div>
550	
551	        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
552	          <div className="space-y-4">
553	            <div><label className="text-xs text-slate-500">Format</label><div className="flex gap-2 mt-1">{Object.entries(FORMATS).map(([k, v]) => (<button key={k} onClick={() => setFmt(k)} className={`text-xs px-3 py-1.5 rounded-lg ${fmt === k ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>{v.label}</button>))}</div></div>
554	
555	            <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
556	              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={markMode} onChange={(e) => setMarkMode(e.target.checked)} className="accent-emerald-500" /> 🦉 Mark</label>
557	              <label className={`flex items-center gap-2 text-sm cursor-pointer ${markMode ? "" : "opacity-40"}`}><input type="checkbox" disabled={!markMode} checked={voiceover} onChange={(e) => setVoiceover(e.target.checked)} className="accent-emerald-500" /> 🎙️ Voice</label>
558	              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="accent-emerald-500" /> 💬 Captions</label>
559	            </div>
560	
561	            <div>
562	              <label className="text-xs text-slate-500">Hook (first frame — test all 3)</label>
563	              <div className="flex flex-wrap gap-2 mt-1">{hookOpts.map((h) => (<button key={h} onClick={() => setHook(h)} className={`text-xs px-3 py-1.5 rounded-lg ${hook === h ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>{h}</button>))}</div>
564	              <input value={hook} onChange={(e) => setHook(e.target.value)} className={inp + " mt-2"} />
565	            </div>
566	
567	            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-2">
568	              <label className="text-xs text-slate-500">Background — describe it, then Generate (AI), or Upload</label>
569	              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className={inp} />
570	              <div className="flex gap-2">
571	                <button onClick={generate} disabled={gen} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2">{gen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {gen ? "Generating…" : "Generate (AI)"}</button>
572	                <label className="bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2 cursor-pointer"><Upload className="w-4 h-4" /> Upload<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg(f); }} /></label>
573	              </div>
574	            </div>
575	
576	            <div><label className="text-xs text-slate-500">Headline {markMode && "(speech bubble)"}</label><input value={headline} onChange={(e) => setHeadline(e.target.value)} className={inp} /></div>
577	            <div><label className="text-xs text-slate-500">Subtext (image only)</label><input value={sub} onChange={(e) => setSub(e.target.value)} className={inp} /></div>
578	            <div><label className="text-xs text-slate-500">Button</label><input value={cta} onChange={(e) => setCta(e.target.value)} className={inp} /></div>
579	            {markMode && voiceover && <div><label className="text-xs text-slate-500">🎙️ Mark says (voiceover + captions)</label><textarea value={line} onChange={(e) => setLine(e.target.value)} rows={3} className={inp} /></div>}
580	
581	            <div className="flex gap-2 pt-1">
582	              <button onClick={downloadPng} disabled={working} className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-3 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Image</button>
583	              <button onClick={downloadVideo} disabled={working} className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 font-bold px-3 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">{rec ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} {rec ? "Recording…" : "Video"}</button>
584	            </div>
585	            {msg && <div className="text-xs text-slate-300">{msg}</div>}
586	            <p className="text-[11px] text-slate-600">Hook flashes first ~1.8s, captions sync to Mark's voice, clip length follows the voiceover. Best in Chrome (records .mp4). Don&apos;t switch tabs while recording.</p>
587	          </div>
588	
589	          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex items-center justify-center relative">
590	            {!bg && !batch.running && <div className="absolute text-slate-600 text-sm flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Generate or upload a background</div>}
591	            <canvas ref={canvasRef} className="max-h-[72vh] max-w-full rounded-lg shadow-lg" style={{ aspectRatio: `${FORMATS[fmt].w}/${FORMATS[fmt].h}` }} />
592	          </div>
593	        </div>
594	      </div>
595	    </div>
596	  );


===== line 2272 | user =====
Grounding episode in real deal scenario: {"purpose":"purchase","type":"Residential","state":"FL","value":"$242,700","note":"needs_info"} 

════════════════════════════════════════
🎬  THE DEAL DESK: AN INSIDE LOOK
    Ray and Mark dive into how Fetti seals the deal on a unique Florida mortgage.
    HOOK: RAY: We've got a deal to break down!
════════════════════════════════════════

🔥 RAY : We've got a deal to break down! Residential purchase, Florida, $242,700.
        [on-screen: Deal Breakdown Time!]
        (excited/enthusiastic)

🦉 MARK: Let's dive in. It's all about property cash flow.
        [on-screen: Property Cash Flow]
        (calm/informative)

🔥 RAY : Right, not tax returns. We look at how the property earns.
        [on-screen: Not Tax Returns]
        (confident/instructive)

🦉 MARK: Exactly. The property's income, not your past financials, got this deal done.
        [on-screen: Property's Income Matters]
        (matter-of-fact)

🔥 RAY : That's why we're different. Not every lender sees the real potential like we do.
        [on-screen: We're Different]
        (proud/determined)

🦉 MARK: You bring the fire, Ray. I bring the wisdom.
        [on-screen: Fire & Wisdom]
        (playful/respectful)

🔥 RAY : That's why we're unstoppable, my wise feathered friend.
        [on-screen: Unstoppable Duo]
        (warm/appreciative)

🦉 MARK: Ready to apply? Fetti has the money.
        [on-screen: Apply Now!]
        (encouraging/finalizing)

📣 CTA: Ready to apply? Visit Fetti Financial Services and see if we can help fund your dreams.
🦉 SIGN-OFF: Fetti Financial Services, we do money!

🔁 Running gag to grow into next episodes: Ray's constant enthusiasm about their 'secret sauce' while Mark subtly rolls his eyes.
⏱  ~50s
Shell cwd was reset to /Users/fetti/Desktop/Fetti Cap growth /fetti-capital-ai


===== line 2277 | assistant =====
It works — **and it pulled a real deal from your pipeline to do it.** That episode was grounded in an actual anonymized lead (FL residential purchase, $242,700), and the engine wrote the whole Ray ↔ Mark exchange itself:

> 🔥 **RAY:** "That's why we're different. Not every lender sees the real potential like we do."
> 🦉 **MARK:** "You bring the fire, Ray. I bring the wisdom."
> 🔥 **RAY:** "That's why we're unstoppable, my wise feathered friend."

It taught the real concept (qualify on the property's cash flow, not tax returns), stayed compliant (no rate/approval promises), hit the sign-off — and it even **seeded a running gag to carry forward**: *Ray's endless hype about their "secret sauce" while Mark quietly rolls his eyes.* That's the seed of a relationship that grows.

**Honest read:** this is a v1 from a single generation — the lines are a little thin and on-the-nose. It gets *much* richer once the real writers'-room engine has the personas locked, the relationship memory accumulating, and a stronger model behind it. But the concept is proven: **your show can write itself from your real deal flow.**

Let me lock this in.


===== line 2294 | assistant =====
That's a *sharp* refinement, and it locks the whole thing in. Let me make sure I've got it exactly right:

- **Ray = the swagger.** Hip finance guy — cool, stylish, charismatic, makes money look effortless. The **front-man, the Batman** of the duo. Backs the flash with real closed deals.
- **Mark = the all-seeing brain.** Ray's little buddy / right hand — the **Robin** — but he's the genius who sees everything coming (he's an owl, nothing gets past him). Brilliant, accomplished, calm, **deadpan-funny**. *Not* swagger — that's Ray's lane (and it keeps Mark exactly where you've always wanted him: cool and insightful, never street).
- **The duo = Batman & Robin chemistry** — tight, ride-or-die, and **genuinely funny.** The comedy is Mark's deadpan all-seeing wisdom puncturing Ray's swagger, with real love underneath. That's what hooks the audience.

That split is perfect, by the way — swagger on Ray, all-seeing-cool on Mark — because it keeps Mark on-brand while giving the duo its comedy engine. Let me re-run the writers' room with this dynamic dialed in, on a real deal, and see if it *pops* now:


===== line 2298 | assistant =====
**That popped.** The Batman/Robin engine is firing now:

> 😎 **RAY:** "Guess who just landed a $350K rental deal in Georgia?"
> 🦉 **MARK:** "The guy who dances in the mirror when no one is watching?"
> ...
> 🦉 **MARK:** "DSCR means 'Debt Service Coverage Ratio.' It's all about the property's cash flow, not how many selfies you take."
> 😎 **RAY:** "So owning rental property just got as smooth as my dance moves."
> 🦉 **MARK:** "Let's hope it's more profitable than your dance career."

There it is — **Ray's swagger, Mark's deadpan all-seeing button lines, real chemistry, actual laughs** — and it still taught DSCR/cash-flow/no-tax-returns, stayed compliant, and **spun up a running gag on its own**: *Ray's mysterious dance moves vs. his actual financial prowess.* That's a bit that can run for 50 episodes.

**That's the voice. I'm locking it:**
- **Ray** — swaggering hip-finance front-man, earns the flash by closing.
- **Mark** — all-seeing genius little buddy, deadpan wit, never swagger (stays on-brand).
- **Engine** — Mark's deadpan puncturing Ray's swagger, real love underneath, funny enough to rewatch, money taught underneath the comedy.

Two small things I noted to harden in the real engine: a **value guardrail** (it grabbed a junk `$350` from a test lead and smartly rendered it `$350K` — I'll make it skip garbage values and only ground episodes in real, sane deals), and the **running-gag memory** (so "dance moves" actually recurs instead of being reinvented each time).

## Now I build the Writers' Room
With the dynamic locked, I'm building the real engine: persisted Ray/Mark personas, the relationship-memory store, the real-deal feed (with that guardrail), and a **`/show` page** where you hit *Write episode* → it pulls a real deal → drafts the Ray & Mark script → you approve → Mark's memory grows. That's the autopilot brain of the whole series, and it needs nothing from anyone but me.

**Your 3 parallel moves stay open** (fire them whenever — they unlock the voice + picture while I build the brain):
1. **fal.ai key** → animation engine
2. **~2 min of you talking** → I clone "Ray's" voice
3. say the word and I'll hand you the **two-character (Ray + Mark) rig brief** for a motion designer

I'm starting the Writers' Room build now. 🦉😎


===== line 2316 | queue-operation =====
<task-notification>
<task-id>w9rw12enl</task-id>
<tool-use-id>toolu_017wvkWx8EQUtB6nnQvJCqsC</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-fetti-Desktop-Fetti-Cap-growth--fetti-capital-ai/32a5709a-d8db-436d-94b4-c2cc9df1c70c/tasks/w9rw12enl.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "Design the recurring "Mark pranks Ray" comedy engine for the Ray &amp; Mark show + a flagship prank episode" completed</summary>
<result>{"engine":{"engine_name":"THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine","how_it_works":"THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine","structure":["BEAT 1 — THE COLD OPEN MISDIRECT (0-8s): Ray bursts in at full swagger, locked onto the WRONG number — panicking a deal will die ('his W-2 won't qualify him', 'the unit's empty') or over-flexing. This is the bait Mark already saw coming. End the beat on a tiny Ray signature move (cape-swish / secret two-step / sprint to the window).","BEAT 2 — RAY'S SWAGGER PEAKS / THE TRAP IS LIVE (8-20s): Ray commits hard to the wrong solve and struts. Mark, never moving, never blinking, drops ONE deadpan line that springs the prank he pre-rigged (fake alert, switched name tags, the whole office on cue, the empty window). Mark already had the term sheet printed BEFORE Ray worried — establish this to pay off 'the owl always knew.'","BEAT 3 — THE ALL-SEEING PAYOFF (20-32s): The prank lands physically on Ray. Mark reveals he saw it coming ('I saw you at 9:14, you park crooked when you're scheming' / 'You always do the cape thing'). The reveal flips Ray from the wrong number to the right one in a single snap — no re-litigating the joke.","BEAT 4 — THE MONEY LESSON, WELDED TO THE GAG (32-44s): Mark delivers the DSCR/cash-flow lesson in ONE tight deadpan line that uses the prank as its metaphor ('We didn't use his tax returns. We used the property'). Names the exact borrower so a scrolling investor self-identifies: self-employed, write-offs, thin W-2, between jobs, vacant unit — doesn't matter, the RENT carries it.","BEAT 5 — BUSTED-BUT-BONDED + CTA + LOCKED SIGN-OFF (44-50s): Ray, busted and delighted, lands a self-deprecating tag ('Unlike my morning' / 'Okay, that's cold-blooded, little buddy'). Mark, dead center to camera, gives the apply CTA framed as an invitation (never an outcome): 'Apply at fettifi.com.' Then the EXACT locked sign-off: 'Fetti Financial Services, we do money!'"],"dos":["Make the prank ACTIVE, not passive: Mark must spring a trap he rigged on purpose (bait Ray in, switch the name tags, cue the room) — a staged reveal alone reads as a no-op and caps the laugh.","Weld the lesson to the gag's metaphor: the joke and the DSCR teach must be the same object (confetti = gimmick that disappears vs. rent that shows up; empty window = no tenant but the property qualifies itself).","Keep Mark ICE-COLD deadpan and all-seeing — he never moves, never blinks, lands one razor line. His prank proves the owl premise: he saw Ray's exact move coming.","Land the lesson early — by ~the 15s mark have Mark drop the cash-flow mechanism so a cold viewer gets the teach before the back-half banter rides out for the rewatch.","Name the exact borrower out loud: 'self-employed, write-offs, between W-2s, vacant unit — doesn't matter, the rent qualifies it.' That converts a laugh into a tap.","Give Ray ONE signature physical move per episode (cape-swish, secret two-step, window sprint) that Mark has secretly catalogued — it's the engine's running-gag fuel.","End EVERY episode on the exact locked sign-off: 'Fetti Financial Services, we do money!' — non-negotiable.","Frame qualifying as a PROGRAM description ('DSCR loans qualify on the property's rent instead of tax returns'), never a stated outcome on a specific deal.","Keep the prank affectionate — it's Mark protecting Ray from his own bad angle. Always close the bond: 'You were magnificent.' / 'Owls don't blink, Ray.'"],"donts":["DON'T let the prank smother the lesson — if you cut a beat for time, cut prank dialogue, NEVER the money mechanism.","DON'T give Mark swagger, slang, or street energy — that's Ray's lane. Mark is calm, brilliant, deadpan. Breaking this breaks the duo.","DON'T make Mark's prank mean. No humiliation, no power trip — pranks are affection between close friends who adore each other.","DON'T promise rates, approval, or qualification. Avoid flat 'your tax return says NO' (denial claim) — use cash-flow-conditional 'tax return looks weak? the rent can carry it.' Frame the CTA as 'apply / see if the deal qualifies,' never 'get pre-qualified' as a guaranteed outcome.","DON'T ever say 'find the money' — Fetti HAS it / funds the deal. Use the slip as Ray's mistake Mark corrects.","DON'T put real Fetti branding on any in-fiction fake alert/notification — keep spoofs obviously bogus so no out-of-context screenshot reads as a real Fetti rate claim.","DON'T re-litigate the joke after the reveal (two lines of 'wait, you said the tenant—'). Let confusion live on Ray's face; snap to the payoff in one beat.","DON'T reach for tired prank props (whoopee cushion / generic confetti cannon) as the gag itself — the trap should spring from Mark's all-seeing intelligence, not a gag-shop kit.","DON'T forget the anonymization — deals are always 'an investor,' 'a flipper,' never a named/identifiable borrower."],"memory_integration":"The engine runs on two persistent ledgers that make the series compound. (1) THE OWL'S LEDGER (running-gag memory): Mark literally keeps a tally of everything he's caught Ray doing — 'the cape thing,' 'the secret two-step since April,' 'you park crooked when you're scheming.' Each episode adds one entry AND calls back a prior one, so episode 6's Mark can say 'That's the third time this month you tried to rescue a deal I already funded' — the joke gets funnier the more episodes you've seen, rewarding loyal viewers and proving the owl truly sees everything across TIME, not just one scene. (2) THE BOND METER (relationship memory): each prank ends on a warmer beat than it began, and the series visibly escalates the affection arc — early episodes are Mark catching a cocky Ray; mid-series Ray starts (and always fails) to out-prank the owl ('Reverse Uno'); later Ray begins to ANTICIPATE the prank ('what'd you rig this time, feathers?') and even leans into being pranked because he trusts Mark had his win ready the whole time. The relationship grows from 'gotcha' to genuine ride-or-die: Mark pranks because he's already protected Ray. Practically, every script seeds ONE new callable item (a Ray tic, a recurring prop, a catchphrase) into the ledger so future writers can pull it forward — the memory IS the moat that turns a sketch series into characters the audience follows.","flagship_episode":{"title":"The Empty Chair","hook":"Ray sprints in to heroically save a 'dying' deal — Mark funded it twenty minutes ago and set the trap so Ray would have someone to save.","lines":[{"speaker":"RAY","text":"(bursting in, cape-swish) Nobody PANIC. Investor's W-2 won't carry this rental — but the CEO is HERE. Where is he? I'll SAVE the deal!","onscreen":"RAY — CEO. Swagger: maximum."},{"speaker":"MARK","text":"(deadpan, not looking up) He left. Twenty minutes ago. Happy.","onscreen":"MARK — the owl. Already knew."},{"speaker":"RAY","text":"...Left?! The deal's DEAD, Mark — his tax returns are a horror movie!","onscreen":""},{"speaker":"MARK","text":"We didn't read his tax returns. We read the property. DSCR — the rental qualifies on the rent it earns, not his W-2.","onscreen":"DSCR = qualify on the property's rent, not your W-2."},{"speaker":"RAY","text":"(cape slowly lowering) So while I was... rehearsing my entrance—","onscreen":""},{"speaker":"MARK","text":"I funded it. Then I texted you 'URGENT — deal dying' so you'd sprint in. (beat) You always do the cape thing.","onscreen":"The text was the prank. 🦉"},{"speaker":"RAY","text":"(pointing, betrayed and delighted) You LURED me?! You set the whole thing up!","onscreen":""},{"speaker":"MARK","text":"Self-employed, write-offs, thin paycheck, even a vacant unit — doesn't matter. The rent carries it. You were magnificent, Ray. To an empty chair.","onscreen":"Self-employed? Write-offs? The rent can carry it."},{"speaker":"RAY","text":"(laughing, busted) Okay. That's cold-blooded, little buddy.","onscreen":""},{"speaker":"MARK","text":"(dead center to camera, one piece of confetti drifting off his wing) We don't find the money. W
... (truncated 1722 chars, full result in /private/tmp/claude-501/-Users-fetti-Desktop-Fetti-Cap-growth--fetti-capital-ai/32a5709a-d8db-436d-94b4-c2cc9df1c70c/tasks/w9rw12enl.output)</result>
<usage><agent_count>21</agent_count><subagent_tokens>547761</subagent_tokens><tool_uses>24</tool_uses><duration_ms>130406</duration_ms></usage>
</task-notification>


===== line 2319 | user =====
<task-notification>
<task-id>w9rw12enl</task-id>
<tool-use-id>toolu_017wvkWx8EQUtB6nnQvJCqsC</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-fetti-Desktop-Fetti-Cap-growth--fetti-capital-ai/32a5709a-d8db-436d-94b4-c2cc9df1c70c/tasks/w9rw12enl.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "Design the recurring "Mark pranks Ray" comedy engine for the Ray &amp; Mark show + a flagship prank episode" completed</summary>
<result>{"engine":{"engine_name":"THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine","how_it_works":"THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine","structure":["BEAT 1 — THE COLD OPEN MISDIRECT (0-8s): Ray bursts in at full swagger, locked onto the WRONG number — panicking a deal will die ('his W-2 won't qualify him', 'the unit's empty') or over-flexing. This is the bait Mark already saw coming. End the beat on a tiny Ray signature move (cape-swish / secret two-step / sprint to the window).","BEAT 2 — RAY'S SWAGGER PEAKS / THE TRAP IS LIVE (8-20s): Ray commits hard to the wrong solve and struts. Mark, never moving, never blinking, drops ONE deadpan line that springs the prank he pre-rigged (fake alert, switched name tags, the whole office on cue, the empty window). Mark already had the term sheet printed BEFORE Ray worried — establish this to pay off 'the owl always knew.'","BEAT 3 — THE ALL-SEEING PAYOFF (20-32s): The prank lands physically on Ray. Mark reveals he saw it coming ('I saw you at 9:14, you park crooked when you're scheming' / 'You always do the cape thing'). The reveal flips Ray from the wrong number to the right one in a single snap — no re-litigating the joke.","BEAT 4 — THE MONEY LESSON, WELDED TO THE GAG (32-44s): Mark delivers the DSCR/cash-flow lesson in ONE tight deadpan line that uses the prank as its metaphor ('We didn't use his tax returns. We used the property'). Names the exact borrower so a scrolling investor self-identifies: self-employed, write-offs, thin W-2, between jobs, vacant unit — doesn't matter, the RENT carries it.","BEAT 5 — BUSTED-BUT-BONDED + CTA + LOCKED SIGN-OFF (44-50s): Ray, busted and delighted, lands a self-deprecating tag ('Unlike my morning' / 'Okay, that's cold-blooded, little buddy'). Mark, dead center to camera, gives the apply CTA framed as an invitation (never an outcome): 'Apply at fettifi.com.' Then the EXACT locked sign-off: 'Fetti Financial Services, we do money!'"],"dos":["Make the prank ACTIVE, not passive: Mark must spring a trap he rigged on purpose (bait Ray in, switch the name tags, cue the room) — a staged reveal alone reads as a no-op and caps the laugh.","Weld the lesson to the gag's metaphor: the joke and the DSCR teach must be the same object (confetti = gimmick that disappears vs. rent that shows up; empty window = no tenant but the property qualifies itself).","Keep Mark ICE-COLD deadpan and all-seeing — he never moves, never blinks, lands one razor line. His prank proves the owl premise: he saw Ray's exact move coming.","Land the lesson early — by ~the 15s mark have Mark drop the cash-flow mechanism so a cold viewer gets the teach before the back-half banter rides out for the rewatch.","Name the exact borrower out loud: 'self-employed, write-offs, between W-2s, vacant unit — doesn't matter, the rent qualifies it.' That converts a laugh into a tap.","Give Ray ONE signature physical move per episode (cape-swish, secret two-step, window sprint) that Mark has secretly catalogued — it's the engine's running-gag fuel.","End EVERY episode on the exact locked sign-off: 'Fetti Financial Services, we do money!' — non-negotiable.","Frame qualifying as a PROGRAM description ('DSCR loans qualify on the property's rent instead of tax returns'), never a stated outcome on a specific deal.","Keep the prank affectionate — it's Mark protecting Ray from his own bad angle. Always close the bond: 'You were magnificent.' / 'Owls don't blink, Ray.'"],"donts":["DON'T let the prank smother the lesson — if you cut a beat for time, cut prank dialogue, NEVER the money mechanism.","DON'T give Mark swagger, slang, or street energy — that's Ray's lane. Mark is calm, brilliant, deadpan. Breaking this breaks the duo.","DON'T make Mark's prank mean. No humiliation, no power trip — pranks are affection between close friends who adore each other.","DON'T promise rates, approval, or qualification. Avoid flat 'your tax return says NO' (denial claim) — use cash-flow-conditional 'tax return looks weak? the rent can carry it.' Frame the CTA as 'apply / see if the deal qualifies,' never 'get pre-qualified' as a guaranteed outcome.","DON'T ever say 'find the money' — Fetti HAS it / funds the deal. Use the slip as Ray's mistake Mark corrects.","DON'T put real Fetti branding on any in-fiction fake alert/notification — keep spoofs obviously bogus so no out-of-context screenshot reads as a real Fetti rate claim.","DON'T re-litigate the joke after the reveal (two lines of 'wait, you said the tenant—'). Let confusion live on Ray's face; snap to the payoff in one beat.","DON'T reach for tired prank props (whoopee cushion / generic confetti cannon) as the gag itself — the trap should spring from Mark's all-seeing intelligence, not a gag-shop kit.","DON'T forget the anonymization — deals are always 'an investor,' 'a flipper,' never a named/identifiable borrower."],"memory_integration":"The engine runs on two persistent ledgers that make the series compound. (1) THE OWL'S LEDGER (running-gag memory): Mark literally keeps a tally of everything he's caught Ray doing — 'the cape thing,' 'the secret two-step since April,' 'you park crooked when you're scheming.' Each episode adds one entry AND calls back a prior one, so episode 6's Mark can say 'That's the third time this month you tried to rescue a deal I already funded' — the joke gets funnier the more episodes you've seen, rewarding loyal viewers and proving the owl truly sees everything across TIME, not just one scene. (2) THE BOND METER (relationship memory): each prank ends on a warmer beat than it began, and the series visibly escalates the affection arc — early episodes are Mark catching a cocky Ray; mid-series Ray starts (and always fails) to out-prank the owl ('Reverse Uno'); later Ray begins to ANTICIPATE the prank ('what'd you rig this time, feathers?') and even leans into being pranked because he trusts Mark had his win ready the whole time. The relationship grows from 'gotcha' to genuine ride-or-die: Mark pranks because he's already protected Ray. Practically, every script seeds ONE new callable item (a Ray tic, a recurring prop, a catchphrase) into the ledger so future writers can pull it forward — the memory IS the moat that turns a sketch series into characters the audience follows.","flagship_episode":{"title":"The Empty Chair","hook":"Ray sprints in to heroically save a 'dying' deal — Mark funded it twenty minutes ago and set the trap so Ray would have someone to save.","lines":[{"speaker":"RAY","text":"(bursting in, cape-swish) Nobody PANIC. Investor's W-2 won't carry this rental — but the CEO is HERE. Where is he? I'll SAVE the deal!","onscreen":"RAY — CEO. Swagger: maximum."},{"speaker":"MARK","text":"(deadpan, not looking up) He left. Twenty minutes ago. Happy.","onscreen":"MARK — the owl. Already knew."},{"speaker":"RAY","text":"...Left?! The deal's DEAD, Mark — his tax returns are a horror movie!","onscreen":""},{"speaker":"MARK","text":"We didn't read his tax returns. We read the property. DSCR — the rental qualifies on the rent it earns, not his W-2.","onscreen":"DSCR = qualify on the property's rent, not your W-2."},{"speaker":"RAY","text":"(cape slowly lowering) So while I was... rehearsing my entrance—","onscreen":""},{"speaker":"MARK","text":"I funded it. Then I texted you 'URGENT — deal dying' so you'd sprint in. (beat) You always do the cape thing.","onscreen":"The text was the prank. 🦉"},{"speaker":"RAY","text":"(pointing, betrayed and delighted) You LURED me?! You set the whole thing up!","onscreen":""},{"speaker":"MARK","text":"Self-employed, write-offs, thin paycheck, even a vacant unit — doesn't matter. The rent carries it. You were magnificent, Ray. To an empty chair.","onscreen":"Self-employed? Write-offs? The rent can carry it."},{"speaker":"RAY","text":"(laughing, busted) Okay. That's cold-blooded, little buddy.","onscreen":""},{"speaker":"MARK","text":"(dead center to camera, one piece of confetti drifting off his wing) We don't find the money. W
... (truncated 1722 chars, full result in /private/tmp/claude-501/-Users-fetti-Desktop-Fetti-Cap-growth--fetti-capital-ai/32a5709a-d8db-436d-94b4-c2cc9df1c70c/tasks/w9rw12enl.output)</result>
<usage><agent_count>21</agent_count><subagent_tokens>547761</subagent_tokens><tool_uses>24</tool_uses><duration_ms>130406</duration_ms></usage>
</task-notification>


===== line 2323 | user =====
1	{
2	  "summary": "Design the recurring \"Mark pranks Ray\" comedy engine for the Ray & Mark show + a flagship prank episode",
3	  "agentCount": 21,
4	  "logs": [
5	    "Writing 5 prank archetypes in parallel…",
6	    "Scoring 5 concepts across 3 lenses…",
7	    "Top concept: \"The Empty Chair (a.k.a. \"Mark Already Funded It\")\" (composite 42.699999999999996)"
8	  ],
9	  "result": {
10	    "engine": {
11	      "engine_name": "THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine",
12	      "how_it_works": "THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine",
13	      "structure": [
14	        "BEAT 1 — THE COLD OPEN MISDIRECT (0-8s): Ray bursts in at full swagger, locked onto the WRONG number — panicking a deal will die ('his W-2 won't qualify him', 'the unit's empty') or over-flexing. This is the bait Mark already saw coming. End the beat on a tiny Ray signature move (cape-swish / secret two-step / sprint to the window).",
15	        "BEAT 2 — RAY'S SWAGGER PEAKS / THE TRAP IS LIVE (8-20s): Ray commits hard to the wrong solve and struts. Mark, never moving, never blinking, drops ONE deadpan line that springs the prank he pre-rigged (fake alert, switched name tags, the whole office on cue, the empty window). Mark already had the term sheet printed BEFORE Ray worried — establish this to pay off 'the owl always knew.'",
16	        "BEAT 3 — THE ALL-SEEING PAYOFF (20-32s): The prank lands physically on Ray. Mark reveals he saw it coming ('I saw you at 9:14, you park crooked when you're scheming' / 'You always do the cape thing'). The reveal flips Ray from the wrong number to the right one in a single snap — no re-litigating the joke.",
17	        "BEAT 4 — THE MONEY LESSON, WELDED TO THE GAG (32-44s): Mark delivers the DSCR/cash-flow lesson in ONE tight deadpan line that uses the prank as its metaphor ('We didn't use his tax returns. We used the property'). Names the exact borrower so a scrolling investor self-identifies: self-employed, write-offs, thin W-2, between jobs, vacant unit — doesn't matter, the RENT carries it.",
18	        "BEAT 5 — BUSTED-BUT-BONDED + CTA + LOCKED SIGN-OFF (44-50s): Ray, busted and delighted, lands a self-deprecating tag ('Unlike my morning' / 'Okay, that's cold-blooded, little buddy'). Mark, dead center to camera, gives the apply CTA framed as an invitation (never an outcome): 'Apply at fettifi.com.' Then the EXACT locked sign-off: 'Fetti Financial Services, we do money!'"
19	      ],
20	      "dos": [
21	        "Make the prank ACTIVE, not passive: Mark must spring a trap he rigged on purpose (bait Ray in, switch the name tags, cue the room) — a staged reveal alone reads as a no-op and caps the laugh.",
22	        "Weld the lesson to the gag's metaphor: the joke and the DSCR teach must be the same object (confetti = gimmick that disappears vs. rent that shows up; empty window = no tenant but the property qualifies itself).",
23	        "Keep Mark ICE-COLD deadpan and all-seeing — he never moves, never blinks, lands one razor line. His prank proves the owl premise: he saw Ray's exact move coming.",
24	        "Land the lesson early — by ~the 15s mark have Mark drop the cash-flow mechanism so a cold viewer gets the teach before the back-half banter rides out for the rewatch.",
25	        "Name the exact borrower out loud: 'self-employed, write-offs, between W-2s, vacant unit — doesn't matter, the rent qualifies it.' That converts a laugh into a tap.",
26	        "Give Ray ONE signature physical move per episode (cape-swish, secret two-step, window sprint) that Mark has secretly catalogued — it's the engine's running-gag fuel.",
27	        "End EVERY episode on the exact locked sign-off: 'Fetti Financial Services, we do money!' — non-negotiable.",
28	        "Frame qualifying as a PROGRAM description ('DSCR loans qualify on the property's rent instead of tax returns'), never a stated outcome on a specific deal.",
29	        "Keep the prank affectionate — it's Mark protecting Ray from his own bad angle. Always close the bond: 'You were magnificent.' / 'Owls don't blink, Ray.'"
30	      ],
31	      "donts": [
32	        "DON'T let the prank smother the lesson — if you cut a beat for time, cut prank dialogue, NEVER the money mechanism.",
33	        "DON'T give Mark swagger, slang, or street energy — that's Ray's lane. Mark is calm, brilliant, deadpan. Breaking this breaks the duo.",
34	        "DON'T make Mark's prank mean. No humiliation, no power trip — pranks are affection between close friends who adore each other.",
35	        "DON'T promise rates, approval, or qualification. Avoid flat 'your tax return says NO' (denial claim) — use cash-flow-conditional 'tax return looks weak? the rent can carry it.' Frame the CTA as 'apply / see if the deal qualifies,' never 'get pre-qualified' as a guaranteed outcome.",
36	        "DON'T ever say 'find the money' — Fetti HAS it / funds the deal. Use the slip as Ray's mistake Mark corrects.",
37	        "DON'T put real Fetti branding on any in-fiction fake alert/notification — keep spoofs obviously bogus so no out-of-context screenshot reads as a real Fetti rate claim.",
38	        "DON'T re-litigate the joke after the reveal (two lines of 'wait, you said the tenant—'). Let confusion live on Ray's face; snap to the payoff in one beat.",
39	        "DON'T reach for tired prank props (whoopee cushion / generic confetti cannon) as the gag itself — the trap should spring from Mark's all-seeing intelligence, not a gag-shop kit.",
40	        "DON'T forget the anonymization — deals are always 'an investor,' 'a flipper,' never a named/identifiable borrower."
41	      ],
42	      "memory_integration": "The engine runs on two persistent ledgers that make the series compound. (1) THE OWL'S LEDGER (running-gag memory): Mark literally keeps a tally of everything he's caught Ray doing — 'the cape thing,' 'the secret two-step since April,' 'you park crooked when you're scheming.' Each episode adds one entry AND calls back a prior one, so episode 6's Mark can say 'That's the third time this month you tried to rescue a deal I already funded' — the joke gets funnier the more episodes you've seen, rewarding loyal viewers and proving the owl truly sees everything across TIME, not just one scene. (2) THE BOND METER (relationship memory): each prank ends on a warmer beat than it began, and the series visibly escalates the affection arc — early episodes are Mark catching a cocky Ray; mid-series Ray starts (and always fails) to out-prank the owl ('Reverse Uno'); later Ray begins to ANTICIPATE the prank ('what'd you rig this time, feathers?') and even leans into being pranked because he trusts Mark had his win ready the whole time. The relationship grows from 'gotcha' to genuine ride-or-die: Mark pranks because he's already protected Ray. Practically, every script seeds ONE new callable item (a Ray tic, a recurring prop, a catchphrase) into the ledger so future writers can pull it forward — the memory IS the moat that turns a sketch series into characters the audience follows.",
43	      "flagship_episode": {
44	        "title": "The Empty Chair",
45	        "hook": "Ray sprints in to heroically save a 'dying' deal — Mark funded it twenty minutes ago and set the trap so Ray would have someone to save.",
46	        "lines": [
47	          {
48	            "speaker": "RAY",
49	            "text": "(bursting in, cape-swish) Nobody PANIC. Investor's W-2 won't carry this rental — but the CEO is HERE. Where is he? I'll SAVE the deal!",
50	            "onscreen": "RAY — CEO. Swagger: maximum."
51	          },
52	          {
53	            "speaker": "MARK",
54	            "text": "(deadpan, not looking up) He left. Twenty minutes ago. Happy.",
55	            "onscreen": "MARK — the owl. Already knew."
56	          },
57	          {
58	            "speaker": "RAY",
59	            "text": "...Left?! The deal's DEAD, Mark — his tax returns are a horror movie!",
60	            "onscreen": ""
61	          },
62	          {
63	            "speaker": "MARK",
64	            "text": "We didn't read his tax returns. We read the property. DSCR — the rental qualifies on the rent it earns, not his W-2.",
65	            "onscreen": "DSCR = qualify on the property's rent, not your W-2."
66	          },
67	          {
68	            "speaker": "RAY",
69	            "text": "(cape slowly lowering) So while I was... rehearsing my entrance—",
70	            "onscreen": ""
71	          },
72	          {
73	            "speaker": "MARK",
74	            "text": "I funded it. Then I texted you 'URGENT — deal dying' so you'd sprint in. (beat) You always do the cape thing.",
75	            "onscreen": "The text was the prank. 🦉"
76	          },
77	          {
78	            "speaker": "RAY",
79	            "text": "(pointing, betrayed and delighted) You LURED me?! You set the whole thing up!",
80	            "onscreen": ""
81	          },
82	          {
83	            "speaker": "MARK",
84	            "text": "Self-employed, write-offs, thin paycheck, even a vacant unit — doesn't matter. The rent carries it. You were magnificent, Ray. To an empty chair.",
85	            "onscreen": "Self-employed? Write-offs? The rent can carry it."
86	          },
87	          {
88	            "speaker": "RAY",
89	            "text": "(laughing, busted) Okay. That's cold-blooded, little buddy.",
90	            "onscreen": ""
91	          },
92	          {
93	            "speaker": "MARK",
94	            "text": "(dead center to camera, one piece of confetti drifting off his wing) We don't find the money. We have it. Apply at fettifi.com.",
95	            "onscreen": "We HAVE the money. Apply → fettifi.com"
96	          },
97	          {
98	            "speaker": "MARK",
99	            "text": "Fetti Financial Services, we do money!",
100	            "onscreen": "FETTI FINANCIAL SERVICES — NMLS #2267023"
101	          }
102	        ],
103	        "cta": "Self-employed or buying a rental the bank won't touch? On a DSCR loan the property's rent can carry the deal — not your tax returns. Apply at fettifi.com.",
104	        "signoff": "Fetti Financial Services, we do money!",
105	        "running_gag": "Ray's cape-swish hero entrance + 'you always do the cape thing' — logged in The Owl's Ledger for future callbacks (next episode: 'That's the third deal I funded before you finished the cape')."
106	      }
107	    },
108	    "ranking": [
109	      {
110	        "name": "The Empty Chair (a.k.a. \"Mark Already Funded It\")",
111	        "composite": 42.699999999999996,
112	        "compliant": true,
113	        "button": "MARK (deadpan, to camera): \"Self-employed? Your tax return says no. The property says yes. We don't find the money — we have it. Apply at fettifi.com. Fetti Financial Services, we do money!\""
114	      },
115	      {
116	        "name": "The Phantom Alert",
117	        "composite": 42.400000000000006,
118	        "compliant": true,
119	        "button": "\"That one's fake. The deal's real. Apply at fettifi.com — Fetti Financial Services, we do money!\""
120	      },
121	      {
122	        "name": "The Cash-Flow Two-Step",
123	        "composite": 42.400000000000006,
124	        "compliant": true,
125	        "button": "\"You hid the dance for three months. I had it choreographed by week two. Owls don't blink, Ray.\""
126	      },
127	      {
128	        "name": "The Vacancy",
129	        "composite": 41.7,
130	        "compliant": true,
131	        "button": "\"You move fast for a man with no tenant.\""
132	      },
133	      {
134	        "name": "Reverse Uno: The Whoopee Cushion Heist",
135	        "composite": 40.3,
136	        "compliant": true,
137	        "button": "\"I switched the name tags. You pranked yourself — like a borrower who tries to FIND money. We don't find it. We HAVE it, and we qualify the property on the rent it earns.\""
138	      }
139	    ]
140	  },
141	  "workflowProgress": [
142	    {
143	      "type": "workflow_phase",
144	      "index": 1,
145	      "title": "Prank concepts"
146	    },
147	    {
148	      "type": "workflow_phase",
149	      "index": 2,
150	      "title": "Judge"
151	    },
152	    {
153	      "type": "workflow_phase",
154	      "index": 3,
155	      "title": "Synthesize"
156	    },
157	    {
158	      "type": "workflow_agent",
159	      "index": 1,
160	      "label": "write:all-seeing-setup",
161	      "phaseIndex": 1,
162	      "phaseTitle": "Prank concepts",
163	      "agentId": "a89ca5f9e506b1aa7",
164	      "model": "claude-opus-4-8",
165	      "state": "done",
166	      "startedAt": 1782840634112,
167	      "queuedAt": 1782840634089,
168	      "attempt": 1,
169	      "lastToolName": "StructuredOutput",
170	      "lastToolSummary": "The Empty Chair (a.k.a. \"Mark Already Funded It\")",
171	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
172	      "lastProgressAt": 1782840657493,
173	      "tokens": 24048,
174	      "toolCalls": 1,
175	      "durationMs": 23380,
176	      "resultPreview": "{\"concept_name\":\"The Empty Chair (a.k.a. \\\"Mark Already Funded It\\\")\",\"premise\":\"Ray struts into the office hyped to \\\"save\\\" a deal he thinks is dying — a real-estate investor whose W-2 won't qualify him for a rental property. Ray's whole bit is the dramatic rescue: cape-swish energy, \\\"Nobody panic, the CEO is here.\\\" What Ray doesn't know is that Mark — who saw the whole thing coming a mile awa…"
177	    },
178	    {
179	      "type": "workflow_agent",
180	      "index": 2,
181	      "label": "write:deadpan-misdirection",
182	      "phaseIndex": 1,
183	      "phaseTitle": "Prank concepts",
184	      "agentId": "a7a29fe106181e366",
185	      "model": "claude-opus-4-8",
186	      "state": "done",
187	      "startedAt": 1782840634117,
188	      "queuedAt": 1782840634090,
189	      "attempt": 1,
190	      "lastToolName": "StructuredOutput",
191	      "lastToolSummary": "The Vacancy",
192	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
193	      "lastProgressAt": 1782840660959,
194	      "tokens": 31375,
195	      "toolCalls": 2,
196	      "durationMs": 26840,
197	      "resultPreview": "{\"concept_name\":\"The Vacancy\",\"premise\":\"Ray is hyped to brag about a brand-new rental property he just bought — but he's stressing because the unit is empty and his W-2 income alone won't cover the mortgage on his application. Mark, who already saw the whole thing coming, calmly \\\"reassures\\\" Ray with a perfectly straight-faced line about the tenant being handled. The deadpan misdirection: Ray th…"
198	    },
199	    {
200	      "type": "workflow_agent",
201	      "index": 3,
202	      "label": "write:genius-rig",
203	      "phaseIndex": 1,
204	      "phaseTitle": "Prank concepts",
205	      "agentId": "ae38b6bb4647ffde1",
206	      "model": "claude-opus-4-8",
207	      "state": "done",
208	      "startedAt": 1782840634120,
209	      "queuedAt": 1782840634090,
210	      "attempt": 1,
211	      "lastToolName": "StructuredOutput",
212	      "lastToolSummary": "The Phantom Alert",
213	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
214	      "lastProgressAt": 1782840657149,
215	      "tokens": 24060,
216	      "toolCalls": 1,
217	      "durationMs": 23029,
218	      "resultPreview": "{\"concept_name\":\"The Phantom Alert\",\"premise\":\"Ray bursts in hyped about a deal — he's about to \\\"pass\\\" on a self-employed flipper because the guy's tax returns look thin and his W-2 income is basically zero. Mark, who saw this coming a mile away, has quietly rigged Ray's phone with a fake \\\"MARKET ALERT\\\" push notification that flashes increasingly absurd numbers, baiting Ray into a panic spiral…"
219	    },
220	    {
221	      "type": "workflow_agent",
222	      "index": 4,
223	      "label": "write:long-con-callback",
224	      "phaseIndex": 1,
225	      "phaseTitle": "Prank concepts",
226	      "agentId": "a7f9cf4238ab8e704",
227	      "model": "claude-opus-4-8",
228	      "state": "done",
229	      "startedAt": 1782840634120,
230	      "queuedAt": 1782840634090,
231	      "attempt": 1,
232	      "lastToolName": "StructuredOutput",
233	      "lastToolSummary": "The Cash-Flow Two-Step",
234	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
235	      "lastProgressAt": 1782840656934,
236	      "tokens": 24043,
237	      "toolCalls": 1,
238	      "durationMs": 22814,
239	      "resultPreview": "{\"concept_name\":\"The Cash-Flow Two-Step\",\"premise\":\"Running gag all episode: every time a deal closes, Ray breaks into a tiny secret victory dance — the same four-count shoulder-shimmy \\\"two-step\\\" — thinking nobody's caught it. He's been hiding it for weeks. Mark, being an owl who sees everything, has been quietly logging the move the whole time. The long-con payoff: Mark has trained the entire o…"
240	    },
241	    {
242	      "type": "workflow_agent",
243	      "index": 5,
244	      "label": "write:reverse-uno",
245	      "phaseIndex": 1,
246	      "phaseTitle": "Prank concepts",
247	      "agentId": "a1c4b4a31bbc2b4bc",
248	      "model": "claude-opus-4-8",
249	      "state": "done",
250	      "startedAt": 1782840634120,
251	      "queuedAt": 1782840634090,
252	      "attempt": 1,
253	      "lastToolName": "StructuredOutput",
254	      "lastToolSummary": "Reverse Uno: The Whoopee Cushion Heist",
255	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
256	      "lastProgressAt": 1782840657670,
257	      "tokens": 24048,
258	      "toolCalls": 1,
259	      "durationMs": 23550,
260	      "resultPreview": "{\"concept_name\":\"Reverse Uno: The Whoopee Cushion Heist\",\"premise\":\"Ray, feeling cocky, decides TODAY is the day he finally pranks the unprankable owl. He rigs Mark's desk chair with a whoopee cushion, hides a confetti cannon under the seat, and even swaps Mark's coffee for a fizzy decoy — a three-layer trap. He's grinning, filming it, ready for glory. But Mark, being an owl who sees everything co…"
261	    },
262	    {
263	      "type": "workflow_agent",
264	      "index": 6,
265	      "label": "judge:The Empty Chair (a:comedy",
266	      "phaseIndex": 2,
267	      "phaseTitle": "Judge",
268	      "agentId": "a514b16d0aea4f0d6",
269	      "model": "claude-opus-4-8",
270	      "state": "done",
271	      "startedAt": 1782840660981,
272	      "queuedAt": 1782840660963,
273	      "attempt": 1,
274	      "lastToolName": "StructuredOutput",
275	      "lastToolSummary": "A genuinely warm, well-structured gag with a killer button …",
276	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
277	      "lastProgressAt": 1782840668212,
278	      "tokens": 25128,
279	      "toolCalls": 1,
280	      "durationMs": 7231,
281	      "resultPreview": "{\"funny\":7,\"brand_fit\":9,\"teaches_money\":8,\"rewatchable\":7,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A genuinely warm, well-structured gag with a killer button (\\\"You were magnificent. To no one.\\\"), but the prank mechanic is soft — staging an empty chair isn't an active prank, it's a no-op, so the \\\"gotcha\\\" lands more as a reveal than a setup-and-spring.\",\"fix\":\"Make Mark's prank ACTIVE…"
282	    },
283	    {
284	      "type": "workflow_agent",
285	      "index": 7,
286	      "label": "judge:The Empty Chair (a:brand-compliance",
287	      "phaseIndex": 2,
288	      "phaseTitle": "Judge",
289	      "agentId": "acfe4a3bbba665c88",
290	      "model": "claude-opus-4-8",
291	      "state": "done",
292	      "startedAt": 1782840660981,
293	      "queuedAt": 1782840660964,
294	      "attempt": 1,
295	      "lastToolName": "StructuredOutput",
296	      "lastToolSummary": "A near-perfect Batman-&-Robin prank: Mark stays ice-cold de…",
297	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
298	      "lastProgressAt": 1782840667967,
299	      "tokens": 25152,
300	      "toolCalls": 1,
301	      "durationMs": 6986,
302	      "resultPreview": "{\"funny\":8,\"brand_fit\":10,\"teaches_money\":9,\"rewatchable\":8,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A near-perfect Batman-&-Robin prank: Mark stays ice-cold deadpan while pre-funding a DSCR deal, the lesson rides inside the reveal, and it nails every compliance rail and the exact sign-off.\",\"fix\":\"In Mark's button line, tighten \\\"Self-employed? Your tax return says no\\\" — a flat \\\"no\\\" …"
303	    },
304	    {
305	      "type": "workflow_agent",
306	      "index": 8,
307	      "label": "judge:The Empty Chair (a:sells-loans",
308	      "phaseIndex": 2,
309	      "phaseTitle": "Judge",
310	      "agentId": "ab74eead5d9aa287a",
311	      "model": "claude-opus-4-8",
312	      "state": "done",
313	      "startedAt": 1782840660982,
314	      "queuedAt": 1782840660964,
315	      "attempt": 1,
316	      "lastToolName": "StructuredOutput",
317	      "lastToolSummary": "A rare prank where the gag IS the lesson — the empty-chair …",
318	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
319	      "lastProgressAt": 1782840682215,
320	      "tokens": 25127,
321	      "toolCalls": 1,
322	      "durationMs": 21233,
323	      "resultPreview": "{\"funny\":8,\"brand_fit\":10,\"teaches_money\":10,\"rewatchable\":7,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A rare prank where the gag IS the lesson — the empty-chair reveal delivers DSCR's W-2-vs-cash-flow pitch cleanly and makes the exact target borrower want to apply; only weakness is a late-arriving teach and a one-watch surprise.\",\"fix\":\"Move the DSCR mechanism earlier — have Mark drop \\\"…"
324	    },
325	    {
326	      "type": "workflow_agent",
327	      "index": 9,
328	      "label": "judge:The Vacancy:comedy",
329	      "phaseIndex": 2,
330	      "phaseTitle": "Judge",
331	      "agentId": "a4c21c1cab37b2967",
332	      "model": "claude-opus-4-8",
333	      "state": "done",
334	      "startedAt": 1782840660990,
335	      "queuedAt": 1782840660990,
336	      "attempt": 1,
337	      "lastToolName": "StructuredOutput",
338	      "lastToolSummary": "A genuinely clean misdirection: Mark's \"your tenant's alrea…",
339	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
340	      "lastProgressAt": 1782840669710,
341	      "tokens": 25092,
342	      "toolCalls": 1,
343	      "durationMs": 8720,
344	      "resultPreview": "{\"funny\":8,\"brand_fit\":9,\"teaches_money\":9,\"rewatchable\":8,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A genuinely clean misdirection: Mark's \\\"your tenant's already covering it\\\" weaponizes the literal/figurative gap, Ray's sprint-to-the-window is a real physical beat, and the button line \\\"You move fast for a man with no tenant\\\" is a perfect deadpan dagger that earns the rewatch.\",\"fix\":…"
345	    },
346	    {
347	      "type": "workflow_agent",
348	      "index": 10,
349	      "label": "judge:The Vacancy:brand-compliance",
350	      "phaseIndex": 2,
351	      "phaseTitle": "Judge",
352	      "agentId": "a1425d450cb63f860",
353	      "model": "claude-opus-4-8",
354	      "state": "done",
355	      "startedAt": 1782840660990,
356	      "queuedAt": 1782840660990,
357	      "attempt": 1,
358	      "lastToolName": "StructuredOutput",
359	      "lastToolSummary": "Tight, deadpan, and brand-true: the \"no tenant\" misdirectio…",
360	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
361	      "lastProgressAt": 1782840667279,
362	      "tokens": 25119,
363	      "toolCalls": 1,
364	      "durationMs": 6289,
365	      "resultPreview": "{\"funny\":7,\"brand_fit\":9,\"teaches_money\":9,\"rewatchable\":7,\"relationship_depth\":8,\"compliant\":true,\"verdict\":\"Tight, deadpan, and brand-true: the \\\"no tenant\\\" misdirection earns a clean DSCR lesson, Mark stays all-seeing and flat, and it ends on the locked sign-off — but the CTA risks reading as a pre-qualification promise.\",\"fix\":\"Soften the CTA verb so \\\"get pre-qualified on the deal itself\\\" r…"
366	    },
367	    {
368	      "type": "workflow_agent",
369	      "index": 11,
370	      "label": "judge:The Vacancy:sells-loans",
371	      "phaseIndex": 2,
372	      "phaseTitle": "Judge",
373	      "agentId": "a8d93b8abf1881226",
374	      "model": "claude-opus-4-8",
375	      "state": "done",
376	      "startedAt": 1782840660991,
377	      "queuedAt": 1782840660990,
378	      "attempt": 1,
379	      "lastToolName": "StructuredOutput",
380	      "lastToolSummary": "A rare prank that SELLS — the \"no tenant\" misdirection IS t…",
381	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
382	      "lastProgressAt": 1782840669627,
383	      "tokens": 25091,
384	      "toolCalls": 1,
385	      "durationMs": 8636,
386	      "resultPreview": "{\"funny\":8,\"brand_fit\":9,\"teaches_money\":9,\"rewatchable\":8,\"relationship_depth\":8,\"compliant\":true,\"verdict\":\"A rare prank that SELLS — the \\\"no tenant\\\" misdirection IS the DSCR lesson, so the joke can't smother the message because the joke is the message; clean apply CTA, locked sign-off, zero rate/approval promises.\",\"fix\":\"In Mark's payoff line, swap the abstract \\\"qualifies on what this place…"
387	    },
388	    {
389	      "type": "workflow_agent",
390	      "index": 12,
391	      "label": "judge:The Phantom Alert:comedy",
392	      "phaseIndex": 2,
393	      "phaseTitle": "Judge",
394	      "agentId": "ae7ef949b932e56af",
395	      "model": "claude-opus-4-8",
396	      "state": "done",
397	      "startedAt": 1782840667280,
398	      "queuedAt": 1782840660996,
399	      "attempt": 1,
400	      "lastToolName": "StructuredOutput",
401	      "lastToolSummary": "A genuinely funny escalation gag with a killer deadpan butt…",
402	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
403	      "lastProgressAt": 1782840675165,
404	      "tokens": 25116,
405	      "toolCalls": 1,
406	      "durationMs": 7884,
407	      "resultPreview": "{\"funny\":8,\"brand_fit\":9,\"teaches_money\":9,\"rewatchable\":8,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A genuinely funny escalation gag with a killer deadpan button (\\\"I scared you a quarter to death, I rounded up for the bit\\\") — the prank lands and the lesson is welded to the joke, not bolted on.\",\"fix\":\"Tighten the escalation to a clean rule-of-three on-screen and let the absurd numbers …"
408	    },
409	    {
410	      "type": "workflow_agent",
411	      "index": 13,
412	      "label": "judge:The Phantom Alert:brand-compliance",
413	      "phaseIndex": 2,
414	      "phaseTitle": "Judge",
415	      "agentId": "aa4146cccfa0aa281",
416	      "model": "claude-opus-4-8",
417	      "state": "done",
418	      "startedAt": 1782840667968,
419	      "queuedAt": 1782840660996,
420	      "attempt": 1,
421	      "lastToolName": "StructuredOutput",
422	      "lastToolSummary": "Strong, on-brand prank: Mark stays ice-cold and all-seeing,…",
423	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
424	      "lastProgressAt": 1782840691785,
425	      "tokens": 34615,
426	      "toolCalls": 3,
427	      "durationMs": 23817,
428	      "resultPreview": "{\"funny\":8,\"brand_fit\":8,\"teaches_money\":9,\"rewatchable\":8,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"Strong, on-brand prank: Mark stays ice-cold and all-seeing, the fake-number gag IS the lesson (DSCR/bank-statement qualifying), compliant with the exact sign-off — just rebrand the spoof alert so a scary frame can't be screenshotted as a real Fetti rate claim.\",\"fix\":\"Don't put \\\"Fetti\\\" o…"
429	    },
430	    {
431	      "type": "workflow_agent",
432	      "index": 14,
433	      "label": "judge:The Phantom Alert:sells-loans",
434	      "phaseIndex": 2,
435	      "phaseTitle": "Judge",
436	      "agentId": "a49af8dfb53009e17",
437	      "model": "claude-opus-4-8",
438	      "state": "done",
439	      "startedAt": 1782840668213,
440	      "queuedAt": 1782840660996,
441	      "attempt": 1,
442	      "lastToolName": "StructuredOutput",
443	      "lastToolSummary": "Rare prank where the gag IS the lesson — the fake \"scary nu…",
444	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
445	      "lastProgressAt": 1782840675648,
446	      "tokens": 25115,
447	      "toolCalls": 1,
448	      "durationMs": 7435,
449	      "resultPreview": "{\"funny\":8,\"brand_fit\":9,\"teaches_money\":9,\"rewatchable\":8,\"relationship_depth\":8,\"compliant\":true,\"verdict\":\"Rare prank where the gag IS the lesson — the fake \\\"scary number\\\" (rate) misdirects straight into the real one (property cash flow), so the bit sells DSCR instead of smothering it.\",\"fix\":\"Tighten the apply ramp: in the last 5s have Ray re-pull the deal he almost passed on and say the pro…"
450	    },
451	    {
452	      "type": "workflow_agent",
453	      "index": 15,
454	      "label": "judge:The Cash-Flow Two-:comedy",
455	      "phaseIndex": 2,
456	      "phaseTitle": "Judge",
457	      "agentId": "a678045cb81db8866",
458	      "model": "claude-opus-4-8",
459	      "state": "done",
460	      "startedAt": 1782840669628,
461	      "queuedAt": 1782840660997,
462	      "attempt": 1,
463	      "lastToolName": "StructuredOutput",
464	      "lastToolSummary": "A genuinely funny, rewatchable prank with a killer button-l…",
465	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
466	      "lastProgressAt": 1782840689509,
467	      "tokens": 25082,
468	      "toolCalls": 1,
469	      "durationMs": 19881,
470	      "resultPreview": "{\"funny\":8,\"brand_fit\":8,\"teaches_money\":7,\"rewatchable\":9,\"relationship_depth\":8,\"compliant\":true,\"verdict\":\"A genuinely funny, rewatchable prank with a killer button-line — the secret-dance-betrayed-by-his-own-phone gag lands and the \\\"week two\\\" reveal earns second views — but the literal DSCR explainer steps on the comic peak and the 50s runtime is overstuffed.\",\"fix\":\"Cut the explainer dialog…"
471	    },
472	    {
473	      "type": "workflow_agent",
474	      "index": 16,
475	      "label": "judge:The Cash-Flow Two-:brand-compliance",
476	      "phaseIndex": 2,
477	      "phaseTitle": "Judge",
478	      "agentId": "adca2a783d857dff5",
479	      "model": "claude-opus-4-8",
480	      "state": "done",
481	      "startedAt": 1782840669711,
482	      "queuedAt": 1782840660997,
483	      "attempt": 1,
484	      "lastToolName": "StructuredOutput",
485	      "lastToolSummary": "A near-perfect Mark-pranks-Ray: the long-con choreography p…",
486	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
487	      "lastProgressAt": 1782840679959,
488	      "tokens": 25106,
489	      "toolCalls": 1,
490	      "durationMs": 10248,
491	      "resultPreview": "{\"funny\":8,\"brand_fit\":9,\"teaches_money\":9,\"rewatchable\":9,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A near-perfect Mark-pranks-Ray: the long-con choreography pays off the \\\"owl sees everything\\\" device, Mark stays ice-cold deadpan, and the DSCR lesson is welded to the joke (\\\"danced on its own cash flow, not your W-2\\\"), not bolted on.\",\"fix\":\"Tighten one compliance soft-spot: \\\"Investor…"
492	    },
493	    {
494	      "type": "workflow_agent",
495	      "index": 17,
496	      "label": "judge:The Cash-Flow Two-:sells-loans",
497	      "phaseIndex": 2,
498	      "phaseTitle": "Judge",
499	      "agentId": "a053f09c0816be281",
500	      "model": "claude-opus-4-8",
501	      "state": "done",
502	      "startedAt": 1782840675166,
503	      "queuedAt": 1782840660997,
504	      "attempt": 1,
505	      "lastToolName": "StructuredOutput",
506	      "lastToolSummary": "A genuinely great prank that EARNS its lesson — the dancing…",
507	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
508	      "lastProgressAt": 1782840683551,
509	      "tokens": 25081,
510	      "toolCalls": 1,
511	      "durationMs": 8385,
512	      "resultPreview": "{\"funny\":8,\"brand_fit\":9,\"teaches_money\":8,\"rewatchable\":9,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A genuinely great prank that EARNS its lesson — the dancing-on-its-own-cash-flow metaphor IS the gag, so the comedy carries the DSCR teach instead of smothering it; rewatchable and warm, but the actual product mechanics get only one breath at the climax.\",\"fix\":\"Sharpen the climax line int…"
513	    },
514	    {
515	      "type": "workflow_agent",
516	      "index": 18,
517	      "label": "judge:Reverse Uno: The W:comedy",
518	      "phaseIndex": 2,
519	      "phaseTitle": "Judge",
520	      "agentId": "adeb30df1a9c2e072",
521	      "model": "claude-opus-4-8",
522	      "state": "done",
523	      "startedAt": 1782840675649,
524	      "queuedAt": 1782840660997,
525	      "attempt": 1,
526	      "lastToolName": "StructuredOutput",
527	      "lastToolSummary": "A clean, well-structured reverse-uno with a strong \"I saw y…",
528	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
529	      "lastProgressAt": 1782840684004,
530	      "tokens": 25178,
531	      "toolCalls": 1,
532	      "durationMs": 8355,
533	      "resultPreview": "{\"funny\":7,\"brand_fit\":9,\"teaches_money\":8,\"rewatchable\":7,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A clean, well-structured reverse-uno with a strong \\\"I saw you coming at 9:14, you parked crooked\\\" button — but the physical payoff is the most over-used prank trio in existence (whoopee/confetti/fizz), which caps the laugh and the rewatch.\",\"fix\":\"Lose the whoopee-cushion/confetti/fizz c…"
534	    },
535	    {
536	      "type": "workflow_agent",
537	      "index": 19,
538	      "label": "judge:Reverse Uno: The W:brand-compliance",
539	      "phaseIndex": 2,
540	      "phaseTitle": "Judge",
541	      "agentId": "aef13d4c03d0759fa",
542	      "model": "claude-opus-4-8",
543	      "state": "done",
544	      "startedAt": 1782840679960,
545	      "queuedAt": 1782840660997,
546	      "attempt": 1,
547	      "lastToolName": "StructuredOutput",
548	      "lastToolSummary": "A clean, on-brand reverse-uno: Ray's gimmick-chasing litera…",
549	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
550	      "lastProgressAt": 1782840697957,
551	      "tokens": 25202,
552	      "toolCalls": 1,
553	      "durationMs": 17997,
554	      "resultPreview": "{\"funny\":8,\"brand_fit\":9,\"teaches_money\":9,\"rewatchable\":8,\"relationship_depth\":9,\"compliant\":true,\"verdict\":\"A clean, on-brand reverse-uno: Ray's gimmick-chasing literally backfires while deadpan all-seeing Mark turns the confetti into a real DSCR cash-flow lesson — no rate/approval promises, anonymized, exact sign-off, and the find-vs-have-money truth nailed.\",\"fix\":\"Tighten the DSCR exposition:…"
555	    },
556	    {
557	      "type": "workflow_agent",
558	      "index": 20,
559	      "label": "judge:Reverse Uno: The W:sells-loans",
560	      "phaseIndex": 2,
561	      "phaseTitle": "Judge",
562	      "agentId": "a1ea43e968246369a",
563	      "model": "claude-opus-4-8",
564	      "state": "done",
565	      "startedAt": 1782840682216,
566	      "queuedAt": 1782840660997,
567	      "attempt": 1,
568	      "lastToolName": "StructuredOutput",
569	      "lastToolSummary": "Strong reverse-uno where Ray's gimmick-chasing literally ba…",
570	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
571	      "lastProgressAt": 1782840702260,
572	      "tokens": 25177,
573	      "toolCalls": 1,
574	      "durationMs": 20044,
575	      "resultPreview": "{\"funny\":7,\"brand_fit\":9,\"teaches_money\":7,\"rewatchable\":7,\"relationship_depth\":8,\"compliant\":true,\"verdict\":\"Strong reverse-uno where Ray's gimmick-chasing literally backfires into the \\\"have money, don't find it\\\" truth; the DSCR lesson lands but arrives a beat fast for a cold viewer.\",\"fix\":\"Weld the gag to the mechanism so it can't be skipped: have Mark gesture at the confetti — \\\"Confetti's a…"
576	    },
577	    {
578	      "type": "workflow_agent",
579	      "index": 21,
580	      "label": "prank-engine",
581	      "phaseIndex": 3,
582	      "phaseTitle": "Synthesize",
583	      "agentId": "ade9075d85a049125",
584	      "model": "claude-opus-4-8",
585	      "state": "done",
586	      "startedAt": 1782840702277,
587	      "queuedAt": 1782840702262,
588	      "attempt": 1,
589	      "lastToolName": "StructuredOutput",
590	      "lastToolSummary": "THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine",
591	      "promptPreview": "SHOW: \"Ray & Mark — We Do Money\" — a short-form vertical (9:16, ~50s) ANIMATED brand COMEDY for Fetti Financial Services LLC (licensed nonbank mortgage lender, NMLS #2267023). A Batman-&-Robin buddy duo the audience follows for laughs AND money smarts.\nRAY: Fetti's CEO; swaggering hip-finance front-man (the Batman). Cool, stylish, charismatic, makes money look effortless; flashy, big personality; …",
592	      "lastProgressAt": 1782840764457,
593	      "tokens": 33806,
594	      "toolCalls": 1,
595	      "durationMs": 62180,
596	      "resultPreview": "{\"engine_name\":\"THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine\",\"how_it_works\":\"THE OWL ALWAYS KNEW — the Mark Pranks Ray Engine\",\"structure\":[\"BEAT 1 — THE COLD OPEN MISDIRECT (0-8s): Ray bursts in at full swagger, locked onto the WRONG number — panicking a deal will die ('his W-2 won't qualify him', 'the unit's empty') or over-flexing. This is the bait Mark already saw coming. End the beat on …"
597	    }
598	  ],
599	  "totalTokens": 547761,
600	  "totalToolCalls": 24
601	}


===== line 2333 | assistant =====
Locked in. Here's what 21 agents (5 writers, a 15-judge panel, 1 synthesizer) built for **"Mark Pranks Ray."**

## 🦉 The engine: *"THE OWL ALWAYS KNEW"*
Every prank episode runs the same 5 beats — a repeatable formula so any writer (human or AI) can crank them out on-brand:

1. **Cold-open misdirect** — Ray bursts in at full swagger, locked on the *wrong* number, + a signature move (cape-swish / secret two-step / window sprint).
2. **The trap springs** — Mark, ice-cold deadpan, reveals a prank he *pre-rigged* (he already had the deal funded).
3. **All-seeing payoff** — the prank lands; Mark reveals he saw it coming ("you always do the cape thing").
4. **The lesson, welded to the joke** — one deadpan line that *is* the DSCR teach + names the exact borrower so a scrolling investor self-identifies.
5. **Busted-but-bonded** — Ray laughs, CTA, locked sign-off.

## 🎬 The flagship episode it wrote: **"The Empty Chair"**
> 😎 **RAY** *(bursting in, cape-swish):* "Nobody PANIC. Investor's W-2 won't carry this rental — but the CEO is HERE. I'll SAVE the deal!"
> 🦉 **MARK** *(deadpan, not looking up):* "He left. Twenty minutes ago. Happy."
> 😎 **RAY:** "...Left?! The deal's DEAD, Mark — his tax returns are a horror movie!"
> 🦉 **MARK:** "We didn't read his tax returns. We read the property. DSCR — the rental qualifies on the rent it earns, not his W-2."
> 😎 **RAY** *(cape slowly lowering):* "So while I was... rehearsing my entrance—"
> 🦉 **MARK:** "I funded it. Then I texted you 'URGENT — deal dying' so you'd sprint in. *(beat)* You always do the cape thing."
> 😎 **RAY** *(betrayed and delighted):* "You LURED me?!"
> 🦉 **MARK:** "Self-employed, write-offs, thin paycheck, even a vacant unit — doesn't matter. The rent carries it. You were magnificent, Ray. To an empty chair."
> 😎 **RAY** *(laughing, busted):* "Okay. That's cold-blooded, little buddy."
> 🦉 **MARK** *(to camera, one piece of confetti drifting off his wing):* "We don't find the money. We have it. Apply at fettifi.com. **Fetti Financial Services, we do money!**"

Funny, warm, teaches DSCR, names the exact borrower who should apply, and it's **fully compliant** (the judges scrubbed it — no rate/approval promises, "we *have* the money," correct sign-off).

## 🧠 The moat — why it compounds
The engine runs on **two memory ledgers**:
- **The Owl's Ledger** — Mark tallies everything he catches Ray doing ("the cape thing," "the two-step since April"). By episode 6 he can say *"that's the third deal I funded before you finished the cape."* The joke gets funnier the longer you've watched — that rewards loyal viewers and proves the owl really sees all *across time.*
- **The Bond Meter** — the relationship visibly grows: early Mark catches a cocky Ray → Ray tries (and fails) to out-prank the owl → eventually Ray *anticipates* it and leans in, because he trusts Mark already had his win ready. Gotcha → ride-or-die.

That's your show vision — "a relationship that grows" — turned into an actual mechanic.

## 📋 Bonus: a 5-episode slate, ready to animate
**The Empty Chair** · **The Phantom Alert** (Mark spoofs a fake market alert) · **The Cash-Flow Two-Step** (Mark choreographs Ray's secret dance) · **The Vacancy** · **Reverse Uno** (Ray tries to prank Mark, out-pranked instantly).

---

All of this is now saved into the show's DNA, so the **Writers' Room** I build will generate prank episodes in this exact engine from your real deals — pranks baked in from episode one. The three parallel unlocks are still open whenever you want them: **fal.ai key**, **2 min of your voice**, **the Ray+Mark rig brief**. Want me to go build the Writers' Room now?


===== line 2369 | assistant =====
🎙️ **Ray has a voice.** Verified end to end:
- Cartesia key stored (prod + local) ✅
- The voice ID resolves — it's literally named **"Ray"** ✅
- And I generated his first line: **🔊 [ray-voice-test.mp3](Desktop/ray-voice-test.mp3) is on your Desktop** — double-click it and you'll hear Ray say *"Nobody panic. The CEO is here, and I'll save the deal."*

Go listen and tell me if that's *him*. If the swagger's right, both voices are locked.

## Where the show stands now
| Piece | Status |
|---|---|
| 😎🦉 Ray/Mark dynamic + "Mark pranks Ray" engine | ✅ **locked** |
| 🎙️ Mark voice (ElevenLabs) | ✅ |
| 🎙️ Ray voice (Cartesia) | ✅ **live & verified** |
| 🧠 Writers' Room (script engine) | **building next — no blockers** |
| 🎬 Animation (rigs + fal.ai) | awaiting fal.ai key + rig commission |

**Both voices working changes what I can ship next.** Once the Writers' Room is built, I can generate an episode from your real deal flow **and voice the whole thing** — Ray on Cartesia, Mark on ElevenLabs — into a full **audio "table read"** of an episode. You'd literally hear Ray & Mark perform "The Empty Chair" *before a single frame of animation exists.* That's the fastest path to feeling the show come alive.

So that's my next move: **build the Writers' Room engine** (locked personas + the prank engine + the relationship-memory ledgers + the real-deal feed → a `/show` page that writes episodes on demand), then wire it to both voices for table reads.

I'm starting the build now. Want the first table read to be **"The Empty Chair,"** or should the engine write a **fresh** prank episode from your latest real deal?
