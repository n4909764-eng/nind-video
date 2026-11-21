/** In-app Help & Support FAQs (English UI). Keep answers accurate to the current product. */
export const FAQ_CATEGORIES = [
  {
    id: "getting-started",
    title: "Getting started",
    items: [
      {
        id: "what-is-nind",
        question: "What is nind ai?",
        answer:
          "nind ai is a platform for creating and editing video content. Type a short prompt and nind ai can produce a complete video with a script, an AI voiceover, visuals, word-timed subtitles and headlines. You can also upload a video you already have and ask nind ai to edit it — for example add captions, headlines, b-roll or a translation.",
      },
      {
        id: "get-started",
        question: "How do I get started?",
        answer:
          "Create an account, then use the editor on the home screen. Describe the video you want (for example “create a video story about…” or “create a promo video about…”), optionally attach images or footage, choose a quality level, and send. New accounts receive 20 welcome credits, which is enough to make a first video.",
      },
      {
        id: "without-subscription",
        question: "Can I use nind ai without a subscription?",
        answer:
          "Yes. You can sign up and start with 20 free welcome credits. A new video needs at least 10 credits, and an edit needs at least 3. When you want more credits, you can subscribe to a plan. Top-ups are available only if you already have an active subscription.",
      },
      {
        id: "what-to-write",
        question: "What should I write in the prompt?",
        answer:
          "Write a clear request in everyday language. For a new video, try “create a video story about…” or “create a promo video about…”. To edit your own footage, attach the file and try “edit my video and add subtitles and headlines”, or “translate my video to Spanish with dubbing”. The more specific you are about the topic, style, language and length, the closer the result will be to what you want.",
      },
    ],
  },
  {
    id: "creating-videos",
    title: "Creating videos",
    items: [
      {
        id: "create-from-prompt",
        question: "How do I create a video from a prompt?",
        answer:
          "On the home screen, type what you want the video to be about and send it. nind ai writes a script, generates a voiceover, picks or creates visuals, and adds subtitles and headlines. By default this produces a short vertical video. If you want a long horizontal video, say so in the prompt.",
      },
      {
        id: "quality-levels",
        question: "What do Low, Default and High mean?",
        answer:
          "These are quality levels for creation and editing.\n\n**Low** is cost-effective: it relies mostly on stock media and uses at most one or two generated images.\n\n**Default** is the balanced option for most videos.\n\n**High** aims for the highest quality: a premium AI voice, more generated images, and HD stock media from the internet.\n\nHigher levels usually use more credits because they do more processing.",
      },
      {
        id: "high-stock-media",
        question: "Does High always include photos or videos from the internet?",
        answer:
          "High is designed to use HD stock media and more generated images when they fit the story, and nind ai checks more carefully that those visuals are actually included. A clip may still be mostly generated or on-screen text if that fits the prompt better. If a High video is missing the internet or stock footage you expected, try a more specific prompt (for example “include stock footage of city streets”) or write to support@nind.pro.",
      },
      {
        id: "generation-time",
        question: "How long does a video take to generate?",
        answer:
          "A typical short video takes a few minutes. Edits are usually faster. Time depends on the length of the video, the quality level, and how busy third-party AI providers are. If a provider is slow or unavailable, a job may take longer or fail. You are only charged credits for processing that was actually performed.",
      },
      {
        id: "create-languages",
        question: "What languages can I create videos in?",
        answer:
          "nind ai can create videos and subtitles in many languages, including English, Spanish, German, French, Russian and others. Quality can vary by language, so always review the result, especially names, numbers and on-screen text.",
      },
      {
        id: "fonts-and-colours",
        question: "Can I change fonts and colours for subtitles and headlines?",
        answer:
          "Yes. After a video is created, you can change the font and the colour of subtitles, headlines and the word highlight. You can also turn subtitles or headlines on or off. Ask for a change in an edit, for example “use Montserrat and a blue highlight”.",
      },
    ],
  },
  {
    id: "long-form",
    title: "Long form and short form",
    items: [
      {
        id: "short-vs-long",
        question: "What is short form vs long form?",
        answer:
          "By default, nind ai creates **short form**: a vertical video, usually up to about 5 minutes. **Long form** is a longer, horizontal video — typically about 5 to 40–50 minutes — and is used when you ask for it in your prompt (for example “make a long 20-minute horizontal video”).",
      },
      {
        id: "request-long-form",
        question: "How do I make a long horizontal video?",
        answer:
          "Say it clearly in your prompt, including the length you want, for example “create a 15-minute horizontal video about…”. If you do not ask for long form, nind ai stays with short vertical video. Long-form jobs need more processing, so they usually cost more credits and take longer.",
      },
      {
        id: "smart-reframe",
        question: "What is Smart Reframe?",
        answer:
          "Smart Reframe is intelligent cropping. If you upload or use a **short horizontal** source, nind ai still makes a short-form **vertical** video and uses Smart Reframe to keep the important part of the frame in view, instead of a simple centre crop.",
      },
      {
        id: "long-vertical-source",
        question: "What if my source video is vertical but long?",
        answer:
          "A long vertical source is treated closer to short form, but nind ai follows your prompt closely. If you ask for a long horizontal edit, say so; otherwise you will usually get a shorter vertical result based on the most relevant parts of your footage.",
      },
    ],
  },
  {
    id: "editing-created",
    title: "Editing created videos",
    items: [
      {
        id: "edit-created",
        question: "How do I edit a video I created in nind ai?",
        answer:
          "Open the finished video and describe the change you want. Good examples: “replace the image in scene 3 with a sunset”, “fix the word ‘teh’ in the subtitles”, or “use Montserrat and a blue highlight”. An edit needs at least 3 credits, and usually costs far fewer credits than creating a new video.",
      },
      {
        id: "precise-edits",
        question: "Can I change just one scene, line or image?",
        answer:
          "Yes. Ask for one precise change at a time. nind ai is set up to update only the part you requested, without filling the rest of the video with placeholders or regenerating everything. If a result changed more than you wanted, try a more specific instruction or contact support.",
      },
      {
        id: "edit-created-limits",
        question: "What can I change in a created video?",
        answer:
          "You can usually adjust subtitles, headlines, fonts, highlight colours, individual visuals and parts of the script or voiceover. Very large changes (a new topic, a new length, or a switch from short form to long form) may work better as a fresh generation with a new prompt.",
      },
    ],
  },
  {
    id: "editing-own",
    title: "Editing your own video",
    items: [
      {
        id: "edit-own",
        question: "How do I edit a video I filmed myself?",
        answer:
          "Attach your video in the editor and write what you want, for example “Edit my video”, “edit my video and add subtitles and headlines”, or “translate my video to German with dubbing”. nind ai transcribes the speech and can add captions, headlines, pop-ups and fitting stock or generated media.",
      },
      {
        id: "upload-formats",
        question: "Which video formats can I upload?",
        answer:
          "Common formats are supported, including MP4, MOV, M4V, WebM, MKV, AVI and others. iPhone videos in **.mov / HEVC** are supported. After you attach a file, nind ai extracts a preview frame so you can see a thumbnail even if the browser cannot play HEVC directly. The maximum upload size is 500 MB.",
      },
      {
        id: "upload-preview",
        question: "What should the attached-video preview look like?",
        answer:
          "You should see a thumbnail of a frame from your video, with a play badge and a button to remove the file. If a preview is missing, wait a moment for the frame to be extracted, then try attaching the file again. You can still send the video if the file appears as an attachment.",
      },
      {
        id: "subtitles-from-speech",
        question: "Can nind ai add subtitles from the speech in my video?",
        answer:
          "Yes. nind ai transcribes the speech in your footage and can burn in word-timed subtitles, with the active word highlighted. Always check the transcript — automatic recognition can mis-hear names, rare words or noisy audio. You can ask for corrections in a follow-up edit.",
      },
      {
        id: "headlines-popups",
        question: "Can I add headlines and pop-ups?",
        answer:
          "Yes. Ask for headlines, titles or pop-up text in your prompt. You can also request stock or generated visuals at specific moments, for example “add a headline on the first line and insert b-roll when I mention social media”.",
      },
      {
        id: "translate-dub",
        question: "Can I translate or dub my video?",
        answer:
          "Yes. For translated captions, try “translate my video to German with subtitles”. For an AI voice in the new language, try “translate my video to German with dubbing”. Review the result, especially names and technical terms.",
      },
    ],
  },
  {
    id: "credits",
    title: "Credits",
    items: [
      {
        id: "how-credits-work",
        question: "How do credits work?",
        answer:
          "Credits pay for the processing behind each job — for example writing a script, generating a voiceover or images, transcribing speech, translation and rendering. The number of credits used depends on the quality level (Low, Default or High) and on the length and complexity of the video. Your balance is always shown in the app.",
      },
      {
        id: "welcome-and-minimums",
        question: "How many credits do I get, and how many do I need to start?",
        answer:
          "New accounts receive **20 welcome credits**, once per person. You need at least **10 credits** to start a new video and at least **3 credits** to start an edit. A job never spends more credits than you currently have available.",
      },
      {
        id: "credit-cost-varies",
        question: "Why did a video cost more or less than I expected?",
        answer:
          "Cost depends on what the job actually did and on the level and length you chose. A short Low video that mostly uses stock media costs less than a long High video with a premium voice, generated images and HD footage. After a job finishes, the credits charged are taken from your balance.",
      },
      {
        id: "credits-expire",
        question: "Do unused credits expire?",
        answer:
          "Subscription credits are added each billing month and unused subscription credits expire at the start of the next subscription month. Welcome credits and purchased top-up credits do not expire while your account is active. Credits have no cash value and cannot be transferred. See the [Refund Policy](/refunds) for when money can be returned.",
      },
    ],
  },
  {
    id: "billing",
    title: "Subscriptions and billing",
    items: [
      {
        id: "plans",
        question: "What subscription plans are available?",
        answer:
          "Plans are billed through Whop:\n\n**Starter** — 500 credits, $20/month or $192/year.\n\n**Creator** — 3,000 credits for $69/month or $708/year; 6,000 credits for $119/month or $1,188/year; 9,000 credits for $199/month or $2,028/year.\n\nYou can compare plans on the Upgrade page.",
      },
      {
        id: "annual-credits",
        question: "How does annual billing work?",
        answer:
          "If you choose an annual plan, you pay once for the year, but subscription credits are still added **monthly** (the same monthly amount as the plan). Unused subscription credits still expire at the start of the next subscription month.",
      },
      {
        id: "cancel-subscription",
        question: "How do I cancel a subscription?",
        answer:
          "You can cancel at any time in your Whop account. You keep the plan and its credits until the end of the period you already paid for. After that, the account returns to the free plan. Cancelling does not automatically refund the unused part of the current period, except where required by law or as described in the [Refund Policy](/refunds).",
      },
      {
        id: "top-up",
        question: "What is Top Up, and who can use it?",
        answer:
          "Top Up lets subscribers buy extra credits (from 500 to 50,000) from the Account page. It is available only with an active subscription. Top-up prices will be shown at checkout; you’ll be redirected to the payment provider. Welcome users without a plan need to subscribe first if they need more than their remaining credits.",
      },
      {
        id: "refunds",
        question: "How do refunds work?",
        answer:
          "Welcome credits cannot be refunded. For paid subscriptions, you can usually request a refund within 14 days of a new purchase or renewal if you have not substantially used the credits from that payment (as a rule, less than 10%). Top-up credits can be refunded within 14 days only if none of them have been used. Approved refunds are returned through Whop. Full details are in the [Refund Policy](/refunds). You can also write to support@nind.pro with the subject “Billing”.",
      },
    ],
  },
  {
    id: "account",
    title: "Account and login",
    items: [
      {
        id: "create-account",
        question: "How do I create an account or sign in?",
        answer:
          "Open the sign-in page and enter your email. nind ai sends a one-time confirmation code that expires after 15 minutes — enter the code to create an account or log in. You can also continue with Google. There is no password to remember when you use the email code.",
      },
      {
        id: "google-signin",
        question: "Can I sign in with Google?",
        answer:
          "Yes. On the sign-in page, choose **Continue with Google** and follow the Google account prompt. You can use Google to create an account or to sign back in later.",
      },
      {
        id: "delete-account",
        question: "How do I delete my account?",
        answer:
          "Open Account and use the option to delete your account. This cannot be undone. For how we handle personal data and content after deletion, see the [Privacy Policy](/privacy).",
      },
    ],
  },
  {
    id: "privacy-rules",
    title: "Privacy and content rules",
    items: [
      {
        id: "privacy-data",
        question: "How do you use my data and videos?",
        answer:
          "We use your account details and content to provide the service — for example to generate, edit and store your videos and to process payments. nind ai does not train its models on your content. For the full list of data, legal bases and your rights under GDPR, see the [Privacy Policy](/privacy).",
      },
      {
        id: "who-owns-videos",
        question: "Who owns the videos I create?",
        answer:
          "You own the videos you upload and the results you generate, subject to the [Terms of Service](/terms) and to any rights in third-party stock media or models we use. You are responsible for having the rights to footage, music, faces and voices you upload.",
      },
      {
        id: "content-rules",
        question: "What content is not allowed?",
        answer:
          "You must have the rights to anything you upload, including people’s voices and likenesses. Do not upload illegal content, and do not create deepfakes or other depictions of a real person without the required consent. AI-generated content should be disclosed where required. The full rules are in the [Platform Rules](/rules).",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    items: [
      {
        id: "generation-failed",
        question: "What if generation fails?",
        answer:
          "If a job fails, you are only charged for processing that was actually performed. Try again in a few minutes, or simplify the prompt and attachments. If it keeps failing or the credit charge looks wrong, write to support@nind.pro with what you were trying to make and approximately when it happened. Failed jobs are reviewed case by case.",
      },
      {
        id: "stuck-progress",
        question: "The progress is stuck. What should I do?",
        answer:
          "A video can sit on the same percentage for a while, especially on longer or High jobs. Wait a few minutes and refresh the page. If progress does not move for a long time or the video never appears, contact support@nind.pro and include the time of the job if you can.",
      },
      {
        id: "upload-issues",
        question: "My video won’t upload or attach. What can I try?",
        answer:
          "Check that the file is a supported video format (MP4, MOV, including iPhone HEVC, and others) and is under 500 MB. Use a stable connection and try again. If the thumbnail is slow to appear, wait a moment — the preview frame is extracted on the server. If the attachment still fails, try converting the file to MP4 or write to support@nind.pro.",
      },
      {
        id: "contact-support",
        question: "How do I contact support?",
        answer:
          "Email support@nind.pro. From this Help & Support page you can also open any question, tap **No** under “Did this help?”, and send a short message — we’ll receive it at the same address. Include your account email and a description of what went wrong.",
      },
    ],
  },
];

export const FAQ_ITEMS = FAQ_CATEGORIES.flatMap((category) =>
  category.items.map((item) => ({ ...item, categoryId: category.id, categoryTitle: category.title }))
);
