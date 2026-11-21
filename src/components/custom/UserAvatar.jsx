import { useEffect, useState } from "react";

const DEFAULT_AVATAR = "/assets/profile-icon.png";

export function userPictureUrl(user) {
  const url = user?.picture || user?.avatar;
  if (!url || url === DEFAULT_AVATAR) return "";
  return url;
}

export default function UserAvatar({ user, alt, icon: Icon, iconClassName }) {
  const url = userPictureUrl(user);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={alt || user?.name || ""}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return Icon ? <Icon className={iconClassName} /> : null;
}
