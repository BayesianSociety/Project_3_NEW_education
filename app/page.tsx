import Link from 'next/link';
import Image from 'next/image';
import { puzzles } from '@/data/puzzles';

const heroSprite = '/assets/sprites/main_character.png';

export default function HomePage() {
  return (
    <main style={{ padding: '4rem clamp(1.5rem, 4vw, 5rem)', position: 'relative', zIndex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
        <section
          className="glass-panel"
          style={{
            padding: '3rem',
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 520px) minmax(240px, 400px)',
            gap: '3rem',
            alignItems: 'center'
          }}
        >
          <div>
            <p style={{ textTransform: 'uppercase', letterSpacing: '0.3em', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              Block Coding Puzzles
            </p>
            <h1 style={{ fontSize: '3rem', margin: '0.75rem 0', lineHeight: 1.1 }}>
              Guide Spark through neon clinic adventures.
            </h1>
            <p style={{ color: 'var(--text-muted)', maxWidth: '32rem', fontSize: '1.05rem' }}>
              Assemble candy-colored code blocks, watch the WebGL stage ignite, and collect telemetry on every move. Sequencing,
              loops, and conditionals unlock three pastel missions designed from the provided layout reference.
            </p>
            <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <Link href="/levels/1" className="primary-cta" aria-label="Start puzzle one">
                Start Adventure
              </Link>
              <Link
                href="/#how"
                style={{
                  borderRadius: '999px',
                  padding: '0.85rem 2rem',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-bright)',
                  textDecoration: 'none'
                }}
              >
                How it works
              </Link>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'relative',
                width: '100%',
                paddingBottom: '75%',
                borderRadius: '40px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'radial-gradient(circle at 30% 20%, rgba(255, 182, 239, 0.7), rgba(41, 2, 56, 0.8))'
              }}
            >
              <Image src={heroSprite} alt="Spark avatar" fill style={{ objectFit: 'contain', padding: '2rem' }} />
            </div>
          </div>
        </section>

        <section id="how" className="glass-panel" style={{ padding: '2.5rem' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <div>
              <p style={{ textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                Level Map
              </p>
              <h2 style={{ margin: '0.5rem 0 0', fontSize: '2rem' }}>Exactly three pastel puzzles</h2>
            </div>
            <Link href="/analytics" style={{ color: 'var(--accent-hot)', textDecoration: 'none', fontWeight: 600 }}>
              View analytics &rarr;
            </Link>
          </header>
          <div className="work-grid" style={{ marginTop: '2rem' }}>
            {puzzles.map((puzzle) => (
              <article
                key={puzzle.id}
                style={{
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '28px',
                  padding: '1.5rem',
                  background: 'rgba(17, 7, 32, 0.55)'
                }}
              >
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>{puzzle.concept.toUpperCase()}</p>
                <h3 style={{ margin: '0.5rem 0', fontSize: '1.4rem' }}>{puzzle.title}</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{puzzle.story}</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0', color: 'var(--text-bright)', fontSize: '0.95rem' }}>
                  <li>Goal: {puzzle.goal}</li>
                  <li>Blocks: {puzzle.availableBlocks.join(', ')}</li>
                </ul>
                <Link
                  href={`/levels/${puzzle.id}`}
                  style={{ color: 'var(--accent-hot)', textDecoration: 'none', fontWeight: 600 }}
                  aria-label={`Open puzzle ${puzzle.id}`}
                >
                  Enter Puzzle {puzzle.id}
                </Link>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
