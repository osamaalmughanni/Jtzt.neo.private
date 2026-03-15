export const supportedLanguages = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "de", label: "German", nativeLabel: "Deutsch" }
] as const;

export const resources = {
  en: {
    translation: {
      common: {
        signIn: "Sign in",
        register: "Register",
        admin: "Admin",
        learnMore: "Learn more",
        cancel: "Cancel",
        create: "Create",
        delete: "Delete",
        resetDb: "Reset DB",
        company: "Company",
        username: "Username",
        password: "Password",
        fullName: "Full name",
        language: "Language",
        english: "English",
        german: "Deutsch"
      },
      theme: {
        light: "Light",
        dark: "Dark"
      },
      footer: {
        copyright: "Copyright {{year}} jtzt.com",
        rights: "All rights reserved"
      },
      page: {
        signIn: { title: "Sign in", description: "Sign in to your company workspace." },
        register: { title: "Register", description: "Create a company workspace and start using Jtzt." },
        overview: { title: "Overview", description: "Today, this week, and recent activity." },
        time: { title: "Time", description: "Track sessions, edit entries, and manage notes." },
        calendar: { title: "Calendar", description: "Daily totals for the selected month." },
        projects: { title: "Projects", description: "Projects and tasks for this company." },
        pages: { title: "Pages" },
        settings: { title: "Settings", description: "Users and project structure." },
        users: { title: "Users", description: "All users in this company." },
        create: { title: "Create", description: "Add an employee or company admin." },
        companies: { title: "Companies", description: "Manage tenant companies and system totals." }
      },
      auth: {
        companySignInTitle: "Company sign in",
        companySignInDescription: "Access an existing company workspace.",
        registerTitle: "Register company",
        registerDescription: "Create a new company workspace and initial admin.",
        adminTitle: "Admin sign in",
        adminDescription: "System-level access for platform administration.",
        companyLabel: "Company",
        companyNameLabel: "Company name",
        adminUsernameLabel: "Admin username",
        adminPasswordLabel: "Admin password",
        encryptionKeyLabel: "Encryption key",
        confirmEncryptionKeyLabel: "Confirm encryption key",
        secureModeOn: "Secure mode on",
        secureModeOff: "Secure mode off",
        secureModeOnDescription:
          "This company will require an encryption key at sign in. Jtzt never stores it. Lose it, and access is gone. This browser will then download recovery JSON files with the admin credentials, key, and encrypted backup.",
        secureModeOffDescription:
          "This company will use standard mode. Sign in will require only the company name, username, and password.",
        secureModePlaceholder: "Choose a strong passphrase",
        secureModeConfirmPlaceholder: "Repeat the passphrase",
        secureModeLoginPlaceholder: "Secure mode passphrase",
        signInFailed: "Sign in failed",
        signInAsAdmin: "Sign in as admin",
        companyRegistrationFailed: "Company registration failed",
        createCompany: "Create company",
        creatingCompany: "Creating company...",
        encryptionRequiredTitle: "Encryption key required",
        encryptionRequiredDescription: "This company uses Secure Mode. Enter the encryption key to continue."
      },
      learn: {
        title: "Learn more",
        overviewTitle: "Jtzt overview",
        overviewBody:
          "Jtzt is a compact company workspace built around tenant isolation, efficient local performance, and an optional secure access model.",
        fact1: "Jtzt keeps each company in its own SQLite database for clear isolation and easier operations.",
        fact2: "Secure mode adds a client-held encryption key workflow for companies that want stricter access control.",
        fact3: "The product is built for efficient internal usage, with low-overhead data access and compact interface patterns.",
        detailsTitle: "Company and platform details",
        detailsBody1:
          "Each company can choose between standard access and a secure mode with a client-held encryption key workflow.",
        detailsBody2:
          "The platform stays efficient by keeping the stack small, the interfaces compact, and the data paths direct.",
        companyTitle: "Company",
        firmDataTitle: "Firm data",
        permissionsTitle: "Permissions",
        websiteTitle: "Website"
      },
      adminCompanies: {
        overviewTitle: "System overview",
        overviewDescription: "All company totals in one place, without splitting the page into separate stat boxes.",
        managementTitle: "Companies management",
        managementDescription: "Simple vertical cards with actions grouped under each company for easier scanning on desktop and mobile.",
        noCompanies: "No companies available yet.",
        createdAt: "Created {{value}}",
        databasePath: "Database path",
        addAdmin: "Add admin",
        createCompanyAdmin: "Create company admin",
        createCompanyAdminDescription: "Add another company-level administrator for this tenant.",
        createAdmin: "Create admin",
        downloadDatabase: "Download database",
        databaseDownloaded: "Database downloaded",
        databaseDownloadFailed: "Database download failed",
        companyDeleted: "Company deleted",
        companyDeleteFailed: "Delete failed",
        companyAdminCreated: "Company admin created",
        companyAdminCreateFailed: "Could not create company admin",
        loadFailed: "Could not load companies",
        deleteDialogTitle: "Delete company",
        deleteDialogDescription: "Delete \"{{name}}\" permanently? This cannot be undone.",
        deleting: "Deleting...",
        stats: {
          companies: "Companies",
          admins: "System admins",
          users: "Company users",
          activeTimers: "Active timers"
        }
      }
    }
  },
  de: {
    translation: {
      common: {
        signIn: "Anmelden",
        register: "Registrieren",
        admin: "Admin",
        learnMore: "Mehr erfahren",
        cancel: "Abbrechen",
        create: "Erstellen",
        delete: "Löschen",
        resetDb: "DB zurücksetzen",
        company: "Firma",
        username: "Benutzername",
        password: "Passwort",
        fullName: "Vollständiger Name",
        language: "Sprache",
        english: "English",
        german: "Deutsch"
      },
      theme: {
        light: "Hell",
        dark: "Dunkel"
      },
      footer: {
        copyright: "Copyright {{year}} jtzt.com",
        rights: "Alle Rechte vorbehalten"
      },
      page: {
        signIn: { title: "Anmelden", description: "Melden Sie sich in Ihrem Firmenbereich an." },
        register: { title: "Registrieren", description: "Erstellen Sie einen Firmenbereich und starten Sie mit Jtzt." },
        overview: { title: "Übersicht", description: "Heute, diese Woche und letzte Aktivitäten." },
        time: { title: "Zeit", description: "Sitzungen erfassen, Einträge bearbeiten und Notizen verwalten." },
        calendar: { title: "Kalender", description: "Tagessummen für den ausgewählten Monat." },
        projects: { title: "Projekte", description: "Projekte und Aufgaben für diese Firma." },
        pages: { title: "Seiten" },
        settings: { title: "Einstellungen", description: "Benutzer und Projektstruktur." },
        users: { title: "Benutzer", description: "Alle Benutzer dieser Firma." },
        create: { title: "Erstellen", description: "Mitarbeiter oder Firmen-Admin hinzufügen." },
        companies: { title: "Firmen", description: "Mandantenfirmen und Systemzahlen verwalten." }
      },
      auth: {
        companySignInTitle: "Firmenanmeldung",
        companySignInDescription: "Auf einen bestehenden Firmenbereich zugreifen.",
        registerTitle: "Firma registrieren",
        registerDescription: "Einen neuen Firmenbereich mit erstem Admin erstellen.",
        adminTitle: "Admin-Anmeldung",
        adminDescription: "Systemzugang für die Plattformverwaltung.",
        companyLabel: "Firma",
        companyNameLabel: "Firmenname",
        adminUsernameLabel: "Admin-Benutzername",
        adminPasswordLabel: "Admin-Passwort",
        encryptionKeyLabel: "Verschlüsselungsschlüssel",
        confirmEncryptionKeyLabel: "Verschlüsselungsschlüssel bestätigen",
        secureModeOn: "Sicherer Modus an",
        secureModeOff: "Sicherer Modus aus",
        secureModeOnDescription:
          "Für diese Firma ist bei der Anmeldung ein Verschlüsselungsschlüssel erforderlich. Jtzt speichert ihn nie. Geht er verloren, ist der Zugriff verloren. Danach lädt dieser Browser Recovery-JSON-Dateien mit Admin-Zugangsdaten, Schlüssel und verschlüsseltem Backup herunter.",
        secureModeOffDescription:
          "Diese Firma verwendet den Standardmodus. Für die Anmeldung sind nur Firmenname, Benutzername und Passwort nötig.",
        secureModePlaceholder: "Starke Passphrase wählen",
        secureModeConfirmPlaceholder: "Passphrase wiederholen",
        secureModeLoginPlaceholder: "Passphrase für den sicheren Modus",
        signInFailed: "Anmeldung fehlgeschlagen",
        signInAsAdmin: "Als Admin anmelden",
        companyRegistrationFailed: "Firmenregistrierung fehlgeschlagen",
        createCompany: "Firma erstellen",
        creatingCompany: "Firma wird erstellt...",
        encryptionRequiredTitle: "Verschlüsselungsschlüssel erforderlich",
        encryptionRequiredDescription: "Diese Firma nutzt den sicheren Modus. Geben Sie den Schlüssel ein, um fortzufahren."
      },
      learn: {
        title: "Mehr erfahren",
        overviewTitle: "Jtzt Überblick",
        overviewBody:
          "Jtzt ist ein kompakter Firmenarbeitsbereich mit klarer Mandantentrennung, effizienter lokaler Performance und einem optionalen sicheren Zugriffsmodell.",
        fact1: "Jtzt hält jede Firma in einer eigenen SQLite-Datenbank für klare Trennung und einfachere Abläufe.",
        fact2: "Der sichere Modus ergänzt einen clientseitig gehaltenen Schlüssel-Workflow für strengere Zugriffskontrolle.",
        fact3: "Das Produkt ist auf effiziente interne Nutzung mit direktem Datenzugriff und kompakten Oberflächen ausgelegt.",
        detailsTitle: "Firmen- und Plattformdetails",
        detailsBody1:
          "Jede Firma kann zwischen Standardzugang und einem sicheren Modus mit clientseitig gehaltenem Verschlüsselungsschlüssel wählen.",
        detailsBody2:
          "Die Plattform bleibt effizient durch einen schlanken Stack, kompakte Oberflächen und direkte Datenpfade.",
        companyTitle: "Unternehmen",
        firmDataTitle: "Firmendaten",
        permissionsTitle: "Berechtigungen",
        websiteTitle: "Website"
      },
      adminCompanies: {
        overviewTitle: "Systemübersicht",
        overviewDescription: "Alle Firmenzahlen an einem Ort, ohne die Seite in einzelne Statistikboxen aufzuteilen.",
        managementTitle: "Firmenverwaltung",
        managementDescription: "Einfache vertikale Karten mit gruppierten Aktionen für bessere Übersicht auf Desktop und Mobilgeräten.",
        noCompanies: "Noch keine Firmen vorhanden.",
        createdAt: "Erstellt am {{value}}",
        databasePath: "Datenbankpfad",
        addAdmin: "Admin hinzufügen",
        createCompanyAdmin: "Firmen-Admin erstellen",
        createCompanyAdminDescription: "Einen weiteren Firmen-Administrator für diesen Mandanten hinzufügen.",
        createAdmin: "Admin erstellen",
        downloadDatabase: "Datenbank herunterladen",
        databaseDownloaded: "Datenbank heruntergeladen",
        databaseDownloadFailed: "Datenbank konnte nicht heruntergeladen werden",
        companyDeleted: "Firma gelöscht",
        companyDeleteFailed: "Löschen fehlgeschlagen",
        companyAdminCreated: "Firmen-Admin erstellt",
        companyAdminCreateFailed: "Firmen-Admin konnte nicht erstellt werden",
        loadFailed: "Firmen konnten nicht geladen werden",
        deleteDialogTitle: "Firma löschen",
        deleteDialogDescription: "\"{{name}}\" dauerhaft löschen? Dies kann nicht rückgängig gemacht werden.",
        deleting: "Wird gelöscht...",
        stats: {
          companies: "Firmen",
          admins: "System-Admins",
          users: "Firmenbenutzer",
          activeTimers: "Aktive Timer"
        }
      }
    }
  }
} as const;

export type AppLanguage = (typeof supportedLanguages)[number]["code"];
