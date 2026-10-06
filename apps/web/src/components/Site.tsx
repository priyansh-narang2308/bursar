import { motion } from 'framer-motion';
import { type ReactNode, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../lib/queries';
import { OpenDemoButton } from '../lib/session';
import { AuroraBackground } from './AuroraBackground';
import { Icon, Logo } from './ui';

export const REPO_URL = 'https://github.com/priyansh-narang2308/bursar';

/** Fades its children in once, the first time they scroll into view. Shows them at once without observers or with reduced motion. */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.6, delay: delay / 1000, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** The call to action that fits the visitor: straight to the dashboard if they have a workspace, otherwise open one. */
export function PrimaryAction({
  size = 'lg',
  label = 'Open demo workspace',
}: {
  size?: 'lg' | 'md';
  label?: string;
}) {
  const signedIn = useMe().isSuccess;
  if (signedIn)
    return (
      <Link to="/dashboard" className={`btn btn-primary ${size === 'lg' ? 'btn-lg' : ''}`}>
        Go to dashboard
      </Link>
    );
  return <OpenDemoButton size={size} label={label} />;
}

export function SiteNav() {
  return (
    <header className="lp-nav">
      <div className="lp-nav-inner">
        <Link to="/" className="lp-brand" aria-label="Bursar home">
          <Logo size={20} /> <span>Bursar</span>
        </Link>
        <nav className="lp-links" aria-label="Site">
          <a href="/#how">How it works</a>
          <a href="/#proof">Proof</a>
          <a href="/#try">Try it</a>
          <Link to="/security">Security</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <PrimaryAction size="md" />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot-grid">
        <div className="lp-foot-brand">
          <span className="lp-brand">
            <Logo size={18} /> <span>Bursar</span>
          </span>
          <p className="muted">
            Spend authority for AI agents. Built for the PayPal AI Hackathon. Sandbox only: no real
            money moves.
          </p>
        </div>
        <nav aria-label="Product">
          <h4>Product</h4>
          <a href="/#how">How it works</a>
          <a href="/#proof">Proof</a>
          <a href="/#try">Try it</a>
        </nav>
        <nav aria-label="Trust">
          <h4>Trust</h4>
          <Link to="/security">Security</Link>
          <Link to="/limits">Limits</Link>
          <a href={`${REPO_URL}/tree/main/docs/decisions`} target="_blank" rel="noreferrer">
            Decisions
          </a>
        </nav>
        <nav aria-label="Project">
          <h4>Project</h4>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source <Icon name="arrow" size={12} />
          </a>
          <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">
            Read me
          </a>
        </nav>
      </div>
    </footer>
  );
}

/** A plain reading page that shares the landing page's frame. */
export function PublicPage({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} - Bursar`;
  }, [title]);
  return (
    <AuroraBackground className="lp">
      <SiteNav />
      <main className="lp-wrap lp-doc">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="lp-lede">{lede}</p>
        {children}
      </main>
      <SiteFooter />
    </AuroraBackground>
  );
}
