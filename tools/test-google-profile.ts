/**
 * Unit-ish tests for Google profile upsert: claims → profile → user record.
 * Run: npx tsx tools/test-google-profile.ts
 */
import { profileFromGoogleClaims, mergeGoogleProfile, GoogleUserFields } from '../googleAuth';

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('ok  :', msg);
  }
}

const claims = {
  email: 'Ada.Lovelace@example.com',
  email_verified: true,
  name: 'Ada Lovelace',
  given_name: 'Ada',
  family_name: 'Lovelace',
  picture: 'https://example.com/ada.jpg',
};

const profile = profileFromGoogleClaims(claims);
assert(profile.email === 'ada.lovelace@example.com', 'email is lowercased');
assert(profile.name === 'Ada Lovelace', 'uses claims.name when present');
assert(profile.picture === 'https://example.com/ada.jpg', 'saves picture from claims');
assert(profile.avatar === profile.picture, 'avatar aliases picture');

const givenOnly = profileFromGoogleClaims({
  email: 'ada@example.com',
  given_name: 'Ada',
  family_name: 'Lovelace',
});
assert(givenOnly.name === 'Ada Lovelace', 'falls back to given + family when name is missing');

const givenAlone = profileFromGoogleClaims({ email: 'ada@example.com', given_name: 'Ada' });
assert(givenAlone.name === 'Ada', 'falls back to given_name alone');

const emailOnly = profileFromGoogleClaims({ email: 'ada@example.com' });
assert(emailOnly.name === 'ada', 'falls back to email local-part');
assert(!emailOnly.picture && !emailOnly.avatar, 'omits picture when claim is absent');

// Create-then-refresh path (simulates findOrCreateGoogleUser)
const created: GoogleUserFields = { name: 'placeholder' };
mergeGoogleProfile(created, profile);
assert(created.name === 'Ada Lovelace', 'new user gets Google name');
assert(created.picture === 'https://example.com/ada.jpg', 'new user gets Google picture');
assert(created.avatar === created.picture, 'new user avatar matches picture');
assert(created.authProvider === 'google', 'sets authProvider on create');

const existing: GoogleUserFields = {
  name: 'Old Name',
  avatar: '/assets/profile-icon.png',
  authProvider: 'google',
};
mergeGoogleProfile(existing, profile);
assert(existing.name === 'Ada Lovelace', 'refresh overwrites a name that was not manually edited');
assert(existing.picture === 'https://example.com/ada.jpg', 'refresh updates picture');

const manualName: GoogleUserFields = {
  name: 'Booms Moon',
  name_manual: true,
  picture: 'https://old.example/photo.png',
};
mergeGoogleProfile(manualName, profile);
assert(manualName.name === 'Booms Moon', 'does not overwrite a manually edited name');
assert(manualName.picture === 'https://example.com/ada.jpg', 'still refreshes picture when name is manual');

const manualPic: GoogleUserFields = {
  name: 'Old Name',
  picture: '/uploads/custom.png',
  avatar: '/uploads/custom.png',
  picture_manual: true,
};
mergeGoogleProfile(manualPic, profile);
assert(manualPic.name === 'Ada Lovelace', 'updates name when only the picture was customized');
assert(manualPic.picture === '/uploads/custom.png', 'does not overwrite a manually uploaded picture');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll Google profile upsert assertions passed.');
