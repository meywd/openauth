import Image from "next/image"
import { auth, login, logout } from "./actions"
import styles from "./page.module.css"
import { AccountSwitcherDropdown } from "./components/account-switcher-dropdown"

export default async function Home() {
  const subject = await auth()

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        {/* Account Switcher in top-right when logged in */}
        {subject && (
          <div
            style={{
              position: "absolute",
              top: "1rem",
              right: "1rem",
            }}
          >
            <AccountSwitcherDropdown
              apiBaseUrl="/api"
              authorizeUrl="/authorize"
            />
          </div>
        )}

        <Image
          className={styles.logo}
          src="/next.svg"
          alt="Next.js logo"
          width={180}
          height={38}
          priority
        />
        <ol>
          {subject ? (
            <>
              <li>
                Logged in as <code>{subject.properties.id}</code>.
              </li>
              <li>
                You have multi-account support! Click the account switcher above
                to manage accounts.
              </li>
            </>
          ) : (
            <>
              <li>Login with your email and password.</li>
              <li>
                And then check out <code>app/page.tsx</code>.
              </li>
            </>
          )}
        </ol>

        <div className={styles.ctas}>
          {subject ? (
            <form action={logout}>
              <button className={styles.secondary}>Logout</button>
            </form>
          ) : (
            <form action={login}>
              <button className={styles.primary}>Login with OpenAuth</button>
            </form>
          )}
        </div>
      </main>
      <footer className={styles.footer}>
        <a
          href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/file.svg"
            alt="File icon"
            width={16}
            height={16}
          />
          Learn
        </a>
        <a
          href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/window.svg"
            alt="Window icon"
            width={16}
            height={16}
          />
          Examples
        </a>
        <a
          href="https://nextjs.org?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/globe.svg"
            alt="Globe icon"
            width={16}
            height={16}
          />
          Go to nextjs.org →
        </a>
      </footer>
    </div>
  )
}
