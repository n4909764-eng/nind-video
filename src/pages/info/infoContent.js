// Company, product and resource pages for nind ai.
const D = "November 21, 2026";

export const about = {
  eyebrow: "Company",
  title: "About nind ai",
  intro: [
    "**Create video content. Edit video content. With nind AI.**",
    "nind ai turns a short prompt into a finished, edited video — script, voiceover, visuals, subtitles and headlines included — and edits the videos you already have. We build it for creators, marketers and small teams who need good video every day but don't have hours to spend in an editor.",
  ],
  sections: [
    { h: "What nind ai does", body: [
      { ul: [
        "**Create** — describe a story, a promo or an explainer, and nind ai writes the script, records an AI voiceover, finds licensed stock footage, generates images where needed, and renders a ready-to-post video.",
        "**Edit** — upload your own footage and ask for subtitles, headlines, pop-ups, b-roll inserts or a cleaner cut. Speech is transcribed and captions are timed word by word.",
        "**Translate** — reach new audiences with translated subtitles or AI dubbing.",
        "**Refine** — change one line, one image, the font or the highlight colour without regenerating the whole video.",
      ] },
    ] },
    { h: "How we work", body: [
      { ul: [
        "**Your content is yours.** You own what you upload and what you create, and we don't train our own models on it.",
        "**Pay for what you use.** Credits reflect the real processing behind each video, and you choose the quality level — Low, Default or High.",
        "**Responsible AI.** Clear [Platform Rules](/rules) against deepfakes, impersonation and misinformation.",
      ] },
    ] },
    { h: "Where we are", body: [
      "nind ai is built by a small, independent team based in Oslo, Norway. Questions, ideas or feedback: support@nind.pro.",
    ] },
  ],
  related: [["Pricing", "/upgrade"], ["Contact", "/contact"], ["FAQs", "/faq"]],
};

export const contact = {
  eyebrow: "Company",
  title: "Contact",
  toc: false,
  intro: ["We're a small team and read every message. Write to us at **support@nind.pro** — we usually reply within 1–2 business days."],
  sections: [
    { h: "Pick the right topic", body: [
      { table: { head: ["Topic", "How to reach us"], rows: [
        ["Help with your account, credits or a video", "support@nind.pro — subject \"Support\". Include your account e-mail and project link."],
        ["Billing, subscriptions and refunds", "support@nind.pro — subject \"Billing\". See the [Refund Policy](/refunds)."],
        ["Privacy and data requests", "support@nind.pro — subject \"Privacy\". See the [Privacy Policy](/privacy)."],
        ["Copyright and abuse reports", "See [Report abuse](/report-abuse)."],
        ["Security vulnerabilities", "See [Report security concerns](/security-report)."],
        ["Press, partnerships and enterprise", "support@nind.pro — subject \"Press\", \"Partnership\" or \"Enterprise\"."],
      ] } },
    ] },
    { h: "Company details", body: ["nind ai · Oslo, Norway · nind.pro"] },
  ],
};

export const security = {
  eyebrow: "Company",
  title: "Security",
  intro: ["Your videos can contain your face, your voice and your ideas. Here is how we protect them."],
  sections: [
    { h: "Data protection", body: [
      { ul: [
        "All traffic between your browser and nind.pro is encrypted with HTTPS (TLS).",
        "Uploads and generated videos are stored on our servers and are linked to your account.",
        "We never receive or store your card details — payments are handled by Whop.",
        "Content is sent to third-party AI providers only to process your request, through API connections that are encrypted in transit.",
      ] },
    ] },
    { h: "Account security", body: [
      { ul: [
        "Passwordless sign-in with one-time e-mail codes that expire after 15 minutes, or Google sign-in.",
        "You can sign out and delete your account at any time from your profile.",
        "Keep your e-mail account protected with a strong password and two-factor authentication — it is the key to your nind ai account.",
      ] },
    ] },
    { h: "Operational security", body: [
      { ul: [
        "Access to production systems is limited to the people who need it.",
        "Secrets such as API keys are kept out of source code and stored in server configuration.",
        "Regular backups and dependency updates.",
        "Abuse detection and enforcement of our [Platform Rules](/rules).",
      ] },
    ] },
    { h: "Found a vulnerability?", body: ["Please tell us. See [Report security concerns](/security-report)."] },
  ],
  related: [["Trust Center", "/trust"], ["Privacy Policy", "/privacy"], ["DPA", "/dpa"]],
};

export const trust = {
  eyebrow: "Company",
  title: "Trust Center",
  intro: ["Everything you need to evaluate nind ai for yourself or your team, in one place."],
  sections: [
    { h: "Privacy & data", body: [
      { ul: [
        "Data controller: nind ai, Oslo, Norway — GDPR applies to all users.",
        "We don't sell personal data and don't use your content to train our own AI models.",
        "Delete your account any time; content is removed within 30 days.",
        "Documents: [Privacy Policy](/privacy) · [Cookie Policy](/cookies) · [Your Privacy Choices](/privacy-choices) · [DPA](/dpa).",
      ] },
    ] },
    { h: "Sub-processors", body: [
      { table: { head: ["Provider", "Purpose"], rows: [
        ["Hosting and infrastructure provider", "Storing accounts, uploads and videos; running the Service"],
        ["OpenRouter", "Routing requests to AI models"],
        ["OpenAI, Google (Gemini) — via OpenRouter", "Script writing, voiceover, image generation, vision checks"],
        ["Whop", "Checkout, subscriptions and billing"],
        ["E-mail delivery provider", "Login codes and service e-mails"],
        ["Wikimedia Commons, Openverse, Pexels, Pixabay", "Stock media search (receive search terms only, no personal data)"],
      ] } },
    ] },
    { h: "Responsible AI", body: [
      "Our [Platform Rules](/rules) prohibit non-consensual deepfakes, impersonation, sexual content of real people, election manipulation and deceptive misinformation. Users must disclose AI-generated content where required. Reports are reviewed by a human.",
    ] },
    { h: "Security", body: ["See [Security](/security) for our safeguards and [Report security concerns](/security-report) to report a vulnerability."] },
    { h: "Legal", body: ["[Terms of Service](/terms) · [Enterprise Terms](/enterprise-terms) · [Refund Policy](/refunds)"] },
  ],
};

export const press = {
  eyebrow: "Company",
  title: "Press & Media",
  intro: ["Writing about AI video, creator tools or nind ai? We're happy to help with information, demos and visuals."],
  sections: [
    { h: "Fact sheet", body: [
      { table: { head: ["", ""], rows: [
        ["Name", "nind ai (always lowercase)"],
        ["Website", "nind.pro"],
        ["Tagline", "Create video content. Edit video content. With nind AI."],
        ["What it is", "An AI platform that creates complete videos from a prompt and edits users' own videos — scripts, AI voiceovers, AI images, licensed stock media, word-timed subtitles, headlines and translation"],
        ["Based in", "Oslo, Norway"],
        ["Launched", "2026"],
        ["Pricing", "Free plan with 20 welcome credits; paid plans from $20/month"],
      ] } },
    ] },
    { h: "Brand use", body: [
      "Please write the name as \"nind ai\" in lowercase. Use the logo on a dark background without altering its shape or colours. For logo files, product screenshots or a demo video, e-mail support@nind.pro.",
    ] },
    { h: "Press contact", body: ["support@nind.pro — subject \"Press\". We aim to respond within one business day."] },
  ],
};

export const partnerships = {
  eyebrow: "Company",
  title: "Partnerships",
  intro: ["We work with creators, agencies and companies who want to make more video with less effort."],
  sections: [
    { h: "Ways to partner", body: [
      { ul: [
        "**Creators & affiliates** — share nind ai with your audience. Tell us about your channel and we'll discuss a partnership.",
        "**Agencies & teams** — higher credit volumes, invoicing and the [Enterprise Terms](/enterprise-terms) with a [DPA](/dpa).",
        "**Technology & content partners** — stock media libraries, voice and model providers, and platforms that want to offer AI video to their users.",
        "**Education & non-profits** — reach out if you'd like to use nind ai for teaching or a good cause.",
      ] },
    ] },
    { h: "Get in touch", body: ["E-mail support@nind.pro with the subject \"Partnership\" and a few lines about you, your audience or company, and what you have in mind."] },
  ],
};

export const status = {
  eyebrow: "Product",
  title: "System Status",
  widget: "status",
  toc: false,
  intro: ["Live status of nind ai, checked from your browser when you open this page."],
  sections: [
    { h: "About generation times", body: [
      "A typical video takes a few minutes to create; edits are usually faster. Times depend on video length, the quality level and the load on third-party AI providers. If a provider is slow or unavailable, jobs may take longer or fail — you are only charged for processing that was actually performed.",
    ] },
    { h: "Something not working?", body: ["If the status above is green but you still have a problem, write to support@nind.pro with your account e-mail and the project link."] },
  ],
};

export const styles = {
  eyebrow: "Product",
  title: "Styles",
  intro: ["Every nind ai video can be styled to match your brand. Choose a look when you create, or change it later with a simple edit like \"make the font Bebas Neue and the highlight yellow\"."],
  sections: [
    { h: "Subtitles & headlines", body: [
      { ul: [
        "**Word-by-word subtitles** timed to the voice, with the active word highlighted.",
        "**Headlines** with a highlighted key word to grab attention in the first seconds.",
        "**Fonts**: Inter, Montserrat, Roboto, Oswald, Bebas Neue, Playfair Display and Anton.",
        "**Colours**: set the subtitle, headline and highlight colour to any colour you like.",
        "Turn subtitles or headlines on or off at any time.",
      ] },
    ] },
    { h: "Visual inserts", body: [
      { ul: [
        "Full-screen stock video and photos from licensed libraries.",
        "Rounded picture-in-picture cards and framed pop-ups over your footage.",
        "AI-generated images when stock media doesn't fit the story.",
      ] },
    ] },
    { h: "Quality levels", body: [
      { table: { head: ["Level", "Best for", "What changes"], rows: [
        ["Low", "Cost-effective video creation/editing", "Mostly stock media, at most 1–2 generated images"],
        ["Default", "Optimal video creation/editing", "Balanced mix of stock media and generated images"],
        ["High", "The highest-quality video creation/editing", "Premium AI voice, more generated images and HD stock media"],
      ] } },
    ] },
    { h: "Formats", body: ["Story videos, product promos, explainers, tutorials and more — vertical for Reels, Shorts and TikTok, or horizontal for YouTube. Just describe what you need."] },
  ],
  related: [["Guides & Tutorials", "/guides"], ["Pricing", "/upgrade"]],
};

export const support = {
  eyebrow: "Resources",
  title: "Support",
  toc: false,
  intro: ["Need a hand? Start with the answers below, or write to us — a real person will reply."],
  sections: [
    { h: "Self-service", body: [
      { ul: [
        "[FAQs](/faq) — credits, plans, editing, languages and more.",
        "[Guides & Tutorials](/guides) — how to write prompts, edit your own video and translate it.",
        "[Help center](/help) — in-app help and support chat (sign in for account-specific help).",
        "[System Status](/status) — check whether the service is running normally.",
      ] },
    ] },
    { h: "Contact support", body: [
      "E-mail **support@nind.pro**. To help us help you faster, include:",
      { ul: [
        "the e-mail address of your nind ai account;",
        "a link to the video or project, if it's about a specific video;",
        "what you expected and what happened instead (a screenshot helps).",
      ] },
      "We usually reply within 1–2 business days.",
    ] },
  ],
};

export const guides = {
  eyebrow: "Resources",
  title: "Guides & Tutorials",
  intro: ["Short, practical guides to get great results from nind ai."],
  sections: [
    { h: "1. Create your first video", body: [
      { ol: [
        "Sign in — new accounts get 20 free credits.",
        "Type what the video is about, for example: \"create video story about the history of Paris in 40 seconds\".",
        "Pick a level: **Low** to save credits, **Default** for most videos, **High** for the best voice and visuals.",
        "Press send. You'll see progress while nind ai writes the script, records the voiceover, picks visuals and renders.",
        "Watch the result, then download it or ask for changes.",
      ] },
    ] },
    { h: "2. Write prompts that work", body: [
      { ul: [
        "Say **what**, **who for** and **how long**: \"create promo video about our coffee shop for Instagram, 30 seconds, friendly tone\".",
        "Mention facts the video must include — names, prices, dates, a call to action.",
        "Attach your own images (logo, product photos) to use them in the video.",
        "Name the language if it's not English: \"in Spanish\".",
      ] },
    ] },
    { h: "3. Edit your own video", body: [
      { ol: [
        "Click **+** and attach your video file (up to 500 MB).",
        "Write what to do, e.g. \"edit my video and add subtitles and headlines\" — or simply \"Edit my video\" and nind ai will add subtitles, headlines and fitting inserts.",
        "nind ai transcribes your speech, times captions word by word and adds media where it fits.",
      ] },
    ] },
    { h: "4. Translate a video", body: [
      "Write \"translate my video to German with subtitles\" for translated captions, or \"translate my video to German with dubbing\" for an AI voice in the new language.",
    ] },
    { h: "5. Make precise changes", body: [
      "Open a finished video and describe one change at a time: \"replace the image in scene 3 with a sunset\", \"fix the word 'teh' in the subtitles\", \"use Montserrat font and a blue highlight\". Only the requested part changes, so edits cost far fewer credits than a new video.",
    ] },
    { h: "6. Save credits", body: [
      { ul: [
        "Use Low for drafts and social clips, then High for the final version.",
        "Edit instead of regenerating.",
        "Keep videos short — length drives voiceover and rendering costs.",
      ] },
    ] },
  ],
  related: [["Styles", "/styles"], ["FAQs", "/faq"], ["Platform Rules", "/rules"]],
};

export const blog = {
  eyebrow: "Resources",
  title: "Blog",
  toc: false,
  intro: ["News, product updates and tips from the nind ai team."],
  sections: [
    { h: "Introducing nind ai", body: [
      { note: `${D} · Product` },
      "Today we're opening nind ai at nind.pro — a single place to create video content and edit video content with AI.",
      "Type an idea and get a complete, edited video: a script, a natural AI voiceover, licensed stock footage, AI-generated images where the story needs them, and word-timed subtitles with highlighted headlines. Already filmed something? Upload it and nind ai transcribes your speech, adds captions, headlines and b-roll, and can translate the whole thing with subtitles or AI dubbing.",
      "Three quality levels — Low, Default and High — let you choose between saving credits and maximum quality, and precise edits mean you can fix one line or one image without starting over.",
      "Every new account starts with 20 free credits. [Try it now](/auth) and tell us what you think at support@nind.pro.",
    ] },
    { h: "5 prompt tips for better AI videos", body: [
      { note: `${D} · Tips` },
      { ol: [
        "Lead with the format: \"create video story about…\" or \"create promo video about…\".",
        "Give the audience and platform: \"for TikTok\", \"for a LinkedIn post\".",
        "Set a length — 30 to 60 seconds works best for social.",
        "Include must-have facts so the script doesn't have to guess.",
        "Refine with small edits instead of regenerating.",
      ] },
      "More in our [Guides & Tutorials](/guides).",
    ] },
  ],
};

export const faq = {
  eyebrow: "Resources",
  title: "Frequently Asked Questions",
  intro: ["Quick answers about nind ai. Can't find yours? Write to support@nind.pro."],
  sections: [
    { h: "What is nind ai?", body: ["An AI platform that creates complete edited videos from a text prompt and edits your own videos — with scripts, AI voiceovers, AI images, licensed stock media, subtitles, headlines and translation."] },
    { h: "How do credits work?", body: ["Each video or edit uses credits based on the processing it actually needs and the quality level you choose. New accounts get 20 free credits. A new video can be started with at least 10 credits and an edit with at least 3. Your balance is always shown in the app."] },
    { h: "How much does it cost?", body: ["You can start free with 20 credits. Paid plans: Starter — 500 credits for $20/month ($192/year); Creator — 3,000 credits for $69/month, 6,000 for $119/month or 9,000 for $199/month (annual: $708, $1,188, $2,028). See [Pricing](/upgrade)."] },
    { h: "Do unused credits roll over?", body: ["Subscription credits refresh every billing month and unused ones expire at the start of the next month. Welcome and top-up credits don't expire while your account is active."] },
    { h: "Can I buy more credits?", body: ["Yes — subscribers can buy top-ups of 500 to 50,000 credits from their account page."] },
    { h: "How do I cancel?", body: ["Cancel anytime in your Whop account. You keep your plan until the end of the paid period, then your account returns to the Free plan. See the [Refund Policy](/refunds)."] },
    { h: "Can I edit a video I filmed myself?", body: ["Yes. Attach your video (up to 500 MB) and say what you want — subtitles, headlines, pop-ups, inserts or a translation. See [Guides](/guides)."] },
    { h: "Which languages are supported?", body: ["nind ai can create videos and subtitles in many languages, including English, Spanish, German, French, Russian and more, and translate your videos with subtitles or AI dubbing. Quality can vary between languages, so always review the result."] },
    { h: "Who owns the videos I make?", body: ["You do. You own your uploads and outputs; stock media inside them stays under its original licence. We don't train our own AI models on your content. See the [Terms](/terms)."] },
    { h: "Can I use the videos commercially?", body: ["Yes, as long as you follow our [Platform Rules](/rules), the licences of any stock media included, and the rules of the platforms where you publish — including AI-content labelling where required."] },
    { h: "Is my data safe?", body: ["Your data is encrypted in transit, stored on our servers and shared only with the providers needed to make your video. See [Security](/security) and the [Privacy Policy](/privacy)."] },
    { h: "What if a generation fails?", body: ["You're charged only for processing completed before the failure, and a failed edit keeps your previous version. If it was our fault, contact support and we'll review it and restore credits where appropriate."] },
    { h: "How do I delete my account?", body: ["Open your profile, choose Delete account and confirm. Cancel any active subscription in Whop first."] },
  ],
};

export const reportAbuse = {
  eyebrow: "Legal",
  title: "Report Abuse",
  intro: ["Help us keep nind ai safe. If you see content made with nind ai that breaks our [Platform Rules](/rules) or infringes your rights, tell us. Reports are reviewed by a person, and we keep your identity confidential where possible."],
  sections: [
    { h: "Report harmful content", body: [
      "E-mail **support@nind.pro** with the subject \"Abuse report\" and include:",
      { ul: [
        "a link to the content or video, or a description of where you saw it;",
        "which rule you believe it breaks (for example deepfake, impersonation, harassment, hate, misinformation);",
        "any context that helps us review it quickly.",
      ] },
      { note: "**Child sexual abuse material:** do not download or share it. Report it to us immediately and to your local police or a hotline such as the Norwegian Police (tips.politiet.no) or INHOPE (inhope.org)." },
    ] },
    { h: "If you are depicted without consent", body: [
      "If a video uses your face, voice or likeness without your consent — including a deepfake or sexual content — write to us with the subject \"Likeness complaint\". We prioritise these reports and remove violating content as quickly as possible.",
    ] },
    { h: "Copyright complaints", body: [
      "If you believe content infringes your copyright, send a notice to support@nind.pro with the subject \"Copyright notice\" containing:",
      { ol: [
        "your name and contact details, and if acting for someone else, your authority to do so;",
        "identification of the copyrighted work you claim is infringed;",
        "identification of the infringing material and where it is located (a link if possible);",
        "a statement that you have a good-faith belief the use is not authorised by the owner, its agent or the law;",
        "a statement that the information in your notice is accurate and, under penalty of perjury where applicable, that you are the owner or authorised to act for the owner;",
        "your physical or electronic signature.",
      ] },
      "We will remove or disable access to infringing material and notify the user. If you believe your content was removed by mistake, you may send a counter-notice with the same details explaining why. We terminate the accounts of repeat infringers.",
    ] },
    { h: "What happens next", body: [
      "We acknowledge reports, review them against our rules and the law, and take action such as removing content or suspending accounts. We may contact you for more information. Knowingly false reports may themselves violate our rules.",
    ] },
  ],
  related: [["Platform Rules", "/rules"], ["Terms of Service", "/terms"]],
};

export const securityReport = {
  eyebrow: "Legal",
  title: "Report Security Concerns",
  intro: ["We welcome reports from security researchers and users. If you believe you've found a vulnerability in nind ai, please let us know so we can fix it quickly."],
  sections: [
    { h: "How to report", body: [
      "E-mail **support@nind.pro** with the subject \"Security\" and include:",
      { ul: [
        "a description of the issue and its potential impact;",
        "steps to reproduce, affected URLs or endpoints, and any proof-of-concept;",
        "your contact details if you'd like us to follow up.",
      ] },
      "We'll acknowledge your report within 3 business days and keep you updated on the fix.",
    ] },
    { h: "Guidelines", body: [
      { ul: [
        "Test only with your own account and data; don't access, modify or delete other users' data.",
        "Don't run denial-of-service, spam or social-engineering attacks, or physical attacks.",
        "Don't use automated scanners that generate heavy traffic.",
        "Give us reasonable time to fix the issue before disclosing it publicly.",
      ] },
    ] },
    { h: "Safe harbour", body: [
      "We will not take legal action against researchers who act in good faith, follow these guidelines and report issues to us privately. We're happy to credit you publicly once the issue is resolved, if you wish.",
    ] },
    { h: "Out of scope", body: [
      { ul: [
        "Vulnerabilities in third-party services we use (such as Whop or Google) — report those to the provider.",
        "Missing best-practice headers without a demonstrated impact.",
        "Reports from automated tools without a working proof of concept.",
      ] },
    ] },
  ],
  related: [["Security", "/security"], ["Trust Center", "/trust"]],
};

export const community = {
  eyebrow: "Community",
  title: "Community",
  toc: false,
  intro: ["nind ai is built together with the people who use it. Share what you make, tell us what to build next, and help others get better results."],
  sections: [
    { h: "Share your videos", body: [
      "Post your nind ai videos on TikTok, YouTube, Instagram, X or LinkedIn — we love seeing them. Please follow our [Platform Rules](/rules) and label AI content where the platform requires it.",
    ] },
    { h: "Ideas and feedback", body: [
      "Missing a feature, a font or a language? Found something confusing? Write to support@nind.pro with the subject \"Feedback\". We read every message and many improvements come straight from users.",
    ] },
    { h: "Official channels", body: [
      "Our official accounts on Discord, TikTok, Reddit, X, YouTube and LinkedIn will be listed on this page as they open. Until then, nind.pro and support@nind.pro are the only official nind ai channels. We will never ask for your login code or payment details in a direct message.",
    ] },
  ],
  related: [["Blog", "/blog"], ["Guides & Tutorials", "/guides"], ["Contact", "/contact"]],
};
