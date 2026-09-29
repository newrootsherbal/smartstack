# SmartStack — consent and notice texts (EN / FR)

The exact wording the app shows wherever the law cares about it. This file is the source of truth:
the i18n keys in `apps/web/src/i18n/en.json` and `fr.json` copy it. Any change goes through the
Privacy Officer, and a change to a consent (C1–C5) bumps `CONSENT_VERSION` so people are asked
again.

In `fr.json`, apply the usual Quebec typography (no-break space before « : » and inside « », none
before ? ! ;). Links in brackets open `/privacy` or `/terms` in the current language.

## Consents

| ID | Where | English | Français |
| -- | ----- | ------- | -------- |
| C1 | Sign-up (email) and `/auth/consent` (Google). Required checkbox, unticked | I agree that New Roots Herbal stores my supplements, medications, routine and bottle counts in my account so I can use them on my devices. I have read the [Privacy Policy]. | J’accepte que New Roots Herbal conserve mes suppléments, mes médicaments, ma routine et le nombre de doses restantes dans mon compte afin que je puisse les utiliser sur mes appareils. J’ai lu la [Politique de confidentialité]. |
| C2 | Same screens. Required checkbox, unticked | I am 14 years of age or older. | J’ai 14 ans ou plus. |
| C3 | Same screens, under the checkboxes (not a checkbox) | By creating an account, you accept the [Terms of Use]. | En créant un compte, vous acceptez les [Conditions d’utilisation]. |
| C4 | Health profile, first visit. Required checkbox before anything is saved | I agree that New Roots Herbal stores my health profile (for example, my health conditions) in my account. I can change or delete it at any time. | J’accepte que New Roots Herbal conserve mon profil santé (par exemple, mes problèmes de santé) dans mon compte. Je peux le modifier ou le supprimer en tout temps. |
| C5 | Health profile and Notifications. Switch, off by default | **Use my health profile to send me relevant news** — New Roots Herbal will use your health profile to choose which news notifications you receive (webinars, new products). This is called profiling. It stays off unless you turn it on, and you can turn it off at any time. | **Utiliser mon profil santé pour m’envoyer des nouvelles pertinentes** — New Roots Herbal utilisera votre profil santé pour choisir les notifications de nouvelles que vous recevez (webinaires, nouveaux produits). C’est ce qu’on appelle du profilage. Cette option reste désactivée tant que vous ne l’activez pas, et vous pouvez la désactiver en tout temps. |
| C6 | Notifications. Switch, off by default, per device | **New products, webinars and offers** — Get news notifications from New Roots Herbal on this device, at most one a day. You can turn them off here at any time. | **Nouveaux produits, webinaires et offres** — Recevez sur cet appareil des notifications de nouvelles de New Roots Herbal, au plus une par jour. Vous pouvez les désactiver ici en tout temps. |
| C7 | One-time prompt after turning on reminders | Also get news about new products and webinars? You can turn this off at any time. [Yes] [No thanks] | Recevoir aussi des nouvelles sur les nouveaux produits et les webinaires? Vous pouvez désactiver cette option en tout temps. [Oui] [Non merci] |

## Notices

| ID | Where | English | Français |
| -- | ----- | ------- | -------- |
| N1 | Welcome, under "Continue without an account" | Your stack stays on this device. You can back it up later from your profile. | Vos suppléments restent sur cet appareil. Vous pourrez les sauvegarder plus tard à partir de votre profil. |
| N2 | Health profile footer | Your health profile doesn't change your schedule and isn't medical advice. | Votre profil santé ne modifie pas votre horaire et ne constitue pas un avis médical. |
| N3 | Medication form and its More info | SmartStack doesn't check medication interactions. Follow your doctor’s or pharmacist’s instructions, and ask your pharmacist whether your supplements should be taken apart from this medication. | SmartStack ne vérifie pas les interactions médicamenteuses. Suivez les directives de votre médecin ou de votre pharmacien, et demandez à votre pharmacien si vos suppléments doivent être pris à distance de ce médicament. |
| N4 | Notifications, "Show product names" switch (off by default) | **Show product names in reminders** — Reminders can appear on your lock screen. When this is off, they only say how many products to take. | **Afficher le nom des produits dans les rappels** — Les rappels peuvent s’afficher sur votre écran verrouillé. Lorsque cette option est désactivée, ils indiquent seulement le nombre de produits à prendre. |
| N5 | "Fill from Health Canada" button hint | We only send Health Canada the number you entered. | Nous transmettons seulement le numéro entré à Santé Canada. |
| N6 | Delete my account (confirmation) | This permanently deletes your account, your stack, your products, your health profile and your notification settings on every device. This can't be undone. | Cette action supprime définitivement votre compte, vos suppléments, vos produits, votre profil santé et vos réglages de notifications sur tous vos appareils. Elle est irréversible. |
| N7 | Delete my health profile (confirmation) | This deletes your health profile. Your account and your stack stay. | Cette action supprime votre profil santé. Votre compte et vos suppléments sont conservés. |
| N8 | Inactive-account warning email (subject) | Your SmartStack account will be deleted in 30 days | Votre compte SmartStack sera supprimé dans 30 jours |
| N9 | Inactive-account warning email (body) | You haven’t used SmartStack for almost 3 years, so we’ll delete your account and everything in it on {date}. To keep it, just open the app and log in. | Vous n’avez pas utilisé SmartStack depuis près de 3 ans. Nous supprimerons donc votre compte et tout son contenu le {date}. Pour le conserver, il suffit d’ouvrir l’application et de vous connecter. |
| N10 | News notification title prefix | New Roots Herbal: | New Roots Herbal : |
