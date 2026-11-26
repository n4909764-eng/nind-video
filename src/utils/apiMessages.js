// Turns server error responses and server progress text into the user's UI language.
// The server answers in English (or Russian); the UI shows our own translated strings.
import { tr } from "./translations";

const BY_TEXT = [
  [/too many videos started/i, "errRateVideos"],
  [/too many edits/i, "errRateEdits"],
  [/too many uploads/i, "errRateUploads"],
  [/still rendering|still being processed/i, "errBusyVideo"],
  [/wait until your videos finish/i, "errBusyWait"],
];

/** Localized message for an axios error (or null when the server sent nothing we know). */
export function apiErrorMessage(err, fallbackKey) {
  const status = err?.response?.status;
  const d = err?.response?.data || {};
  const code = d.error;
  const msg = String(d.message || "");
  switch (code) {
    case "content_policy":
      return tr(d.category === "nsfw" ? "errFilePolicy" : "errPolicy");
    case "account_restricted": {
      const m = msg.match(/(\d+)\s+more\s+hour/i);
      return m ? tr("errPausedHours", { n: m[1] }) : tr("errAccountFlagged");
    }
    case "creator_required":
      return tr("highLocked");
    case "file_too_large":
    case "payload_too_large":
      return tr("errFileTooLarge");
    case "unsupported_file_type":
      return tr("errUnsupportedFile");
    case "subscription_required":
      return tr("errSubscriptionRequired");
    case "invalid_amount":
      return tr("errInvalidPack");
    case "checkout_failed":
      return tr("checkoutFailed");
    case "invalid_email":
      return tr("invalidEmail");
    case "invalid_message":
      return tr("writeShortMessage");
    case "auth_required":
      return tr("errSignInAgain");
    case "busy": {
      const m = msg.match(/already have (\d+)/i);
      if (m) return tr("errBusyRendering", { n: m[1] });
      break;
    }
    default:
      break;
  }
  if (status === 402 || code === "Insufficient credits") {
    const p = { required: d.required, current: d.current, estimated: d.estimated };
    if (d.estimated && d.target_seconds) return tr("errNoCreditsLong", { ...p, minutes: Math.max(1, Math.round(d.target_seconds / 60)) });
    if (d.required !== undefined && /edit|правок/i.test(msg)) return tr("errNoCreditsEdit", p);
    if (d.required !== undefined) return tr("errNoCredits", p);
    return tr("insufficientCredits");
  }
  for (const [re, key] of BY_TEXT) if (re.test(msg)) return tr(key);
  if (status === 429) return tr("errRateGeneric");
  return fallbackKey ? tr(fallbackKey) : null;
}

// Server progress text (English or Russian) -> translation key (+ numbers).
const PROGRESS = [
  [/^(Queued for generation|В очереди на генерацию)/i, "progQueued"],
  [/^(Applying edits to video|Применяем правки к видео)/i, "applyingEdits"],
  [/^(Ready!|Готово!)/i, "progReady"],
  [/^(Understanding your edit|Разбираем правку)/i, "progUnderstanding"],
  [/^(Applying the change|Применяем изменение)/i, "progApplyingChange"],
  [/^(Recording the voiceover|Записываем озвучку)/i, "progVoiceover"],
  [/^(Re-rendering only what changed|Перемонтируем только изменённое)/i, "progRerenderChanged"],
  [/^(Preparing your video|Готовим ваше видео)/i, "progPreparing"],
  [/^(Transcribing speech|Распознаём речь)/i, "progTranscribing"],
  [/^(Picking the best moments|Выбираем лучшие моменты)/i, "progBestMoments"],
  [/^(Planning the edit|Планируем монтаж)/i, "progPlanningEdit"],
  [/^(Finding matching footage and photos|Подбираем подходящие видео и фото)/i, "progFindingFootage"],
  [/^(Translating|Переводим)/i, "progTranslating"],
  [/^(Rendering|Рендерим)/i, "progRendering"],
  [/^(Preparing new media|Готовим новые материалы)/i, "progNewMedia"],
  [/^(Re-rendering|Перемонтируем)\.\.\./i, "progRerendering"],
  [/^(?:Planning a (\d+)-minute video|Планируем видео на (\d+) мин)/i, "progPlanningLong", (m) => ({ n: m[1] || m[2] })],
  [/^(?:Writing the script: chapter|Пишем сценарий: глава) (\d+)\/(\d+)/i, "progChapter", (m) => ({ d: m[1], t: m[2] })],
  [/^(?:Voiceover|Озвучка) (\d+)\/(\d+)/i, "progVoiceoverN", (m) => ({ d: m[1], t: m[2] })],
  [/^(Finding real footage and generating photos|Подбираем реальные видео\/фото)/i, "progFootagePhotos"],
  [/^(?:Visuals|Кадры) (\d+)\/(\d+)/i, "progVisuals", (m) => ({ d: m[1], t: m[2] })],
  [/^(Writing the script|Пишем сценарий)\.\.\./i, "progScript"],
  [/^(Syncing subtitles to the voice|Синхронизируем субтитры с голосом)/i, "progSyncSubs"],
  [/^(Creating animated elements|Создаём анимированные элементы)/i, "progAnimated"],
  [/^(?:Editing|Монтаж) (\d+)\/(\d+)/i, "progEditingN", (m) => ({ d: m[1], t: m[2] })],
  [/^(Editing the video|Монтируем видео)/i, "progEditing"],
  [/^(Adding subtitles and effects|Добавляем субтитры и эффекты)/i, "progSubsEffects"],
];

export function localizeProgress(text) {
  const s = String(text || "").trim();
  if (!s) return s;
  for (const [re, key, params] of PROGRESS) {
    const m = s.match(re);
    if (m) return tr(key, params ? params(m) : undefined);
  }
  return s;
}
