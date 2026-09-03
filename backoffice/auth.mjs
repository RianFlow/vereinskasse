import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';

export function authOptions({ database, config, outbox, limiter, activated = async () => {}, emailChanged = async () => {}, registerEmailToken = async () => {}, canLogin = async () => true, provisioning = false }) {
  return {
    appName: 'ClubIQ Verwaltung', baseURL: config.origin, basePath: '/api/auth', secret: config.secret,
    database, trustedOrigins: [config.origin],
    user: { modelName: 'bo_user', changeEmail: { enabled: true, updateEmailWithoutVerification: false,
      async sendChangeEmailConfirmation({user,newEmail,token}) {
        await registerEmailToken('current',token,user.id);
        await outbox.enqueue({to:user.email,subject:'ClubIQ Verwaltung · E-Mail-Änderung bestätigen',
          text:`Hallo ${user.name},\n\ndu möchtest deine persönliche Anmeldeadresse auf ${newEmail} ändern. Bestätige zuerst in deinem bisherigen Postfach:\n${config.origin}/#email-current=${encodeURIComponent(token)}\n\nAnschließend erhält die neue Adresse einen zweiten Bestätigungslink. Jeder Link gilt 15 Minuten. Melde dich dafür mit deinem bisherigen Konto und dem zweiten Faktor an. Wenn du die Änderung nicht angefordert hast, bestätige sie nicht und ändere dein Passwort. Allgemeine Verteiler und das Absenderkonto werden nicht automatisch geändert.`},900);
      }
    }, deleteUser: { enabled: false } },
    emailVerification: { expiresIn:900, sendOnSignUp:false, sendOnSignIn:false, autoSignInAfterVerification:false,
      async sendVerificationEmail({user,token}) {
        await registerEmailToken('new',token,user.id);
        await outbox.enqueue({to:user.email,subject:'ClubIQ Verwaltung · Neue E-Mail-Adresse bestätigen',
          text:`Hallo ${user.name},\n\nbestätige jetzt deine neue persönliche E-Mail-Adresse:\n${config.origin}/#email-new=${encodeURIComponent(token)}\n\nDer Link gilt 15 Minuten und ist nur einmal verwendbar. Bis zur Bestätigung bleibt deine bisherige Anmeldeadresse gültig. Danach werden alle Anmeldungen beendet; melde dich mit der neuen Adresse, deinem bisherigen Passwort und dem zweiten Faktor neu an. Allgemeine Kassenwart-Verteiler pflegt der Vorstand gesondert auf der Wartungsseite.`},900);
      },
      async afterEmailVerification(user) { await emailChanged(user); },
    },
    account: { modelName: 'bo_account', accountLinking: { enabled: false } },
    session: { modelName: 'bo_session', expiresIn: 3600, updateAge: 300, freshAge: 600,
      cookieCache: { enabled: false } },
    verification: { modelName: 'bo_verification', storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true, disableSignUp: !provisioning, autoSignIn: false,
      minPasswordLength: 15, maxPasswordLength: 128, requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }) {
        // Fixed origin + fragment: the reset token never enters proxy access logs/referrers.
        const url = `${config.origin}/#reset=${encodeURIComponent(token)}`;
        await outbox.enqueue({ to: user.email, subject: 'ClubIQ Verwaltung · Passwort festlegen',
          text: `Hallo ${user.name},\n\nüber diesen Link kannst du dein Passwort für die ClubIQ-Verwaltung festlegen oder zurücksetzen:\n${url}\n\nDer Link ist 15 Minuten gültig und nur einmal verwendbar. Dein Passwort muss mindestens 15 Zeichen lang sein. Eine bestehende Zwei-Faktor-Anmeldung bleibt aktiv.\n\nFalls du dies nicht angefordert hast, ignoriere diese Nachricht.`,
        }, 900);
      },
      async onPasswordReset({ user }) { await activated(user); },
    },
    plugins: [twoFactor({ issuer: 'ClubIQ Verwaltung', twoFactorTable: 'bo_two_factor',
      skipVerificationOnEnable: false, accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      backupCodeOptions: { storeBackupCodes: 'encrypted' }, twoFactorCookieMaxAge: 300 })],
    rateLimit: { enabled: true, customStorage: limiter,
      window: 60, max: 60, customRules: {
        '/sign-in/email': { window: 60, max: 5 }, '/request-password-reset': { window: 900, max: 5 },
        '/reset-password': { window: 900, max: 10 }, '/two-factor/*': { window: 60, max: 5 },
      } },
    advanced: {
      useSecureCookies: !config.development, cookiePrefix: 'clubiq_backoffice',
      defaultCookieAttributes: { httpOnly: true, secure: !config.development, sameSite: 'strict', path: '/' },
      crossSubDomainCookies: { enabled: false },
      // server.mjs overwrites this header with the socket peer; public supplied headers are ignored.
      ipAddress: { ipAddressHeaders: ['x-clubiq-peer-ip'] },
    },
    databaseHooks: { session: { create: { before: async session => {
      if (!await canLogin(session.userId)) return false;
    } } } },
    logger: { disabled: true }, // no reset URLs, tokens, SMTP credentials, or personal data in logs
  };
}
export function createAuth(options) {
  let auth;
  auth=betterAuth(authOptions({...options,registerEmailToken:async(stage,token,userId)=>{
    const {internalAdapter}=await auth.$context;
    // Library-managed hashed, expiring, single-use records, tied to an immutable user ID.
    const identifier=`bo-email-${stage}-${token}`;
    await internalAdapter.deleteVerificationByIdentifier(identifier);
    await internalAdapter.createVerificationValue({identifier,value:userId,expiresAt:new Date(Date.now()+900_000)});
  }}));
  return auth;
}
