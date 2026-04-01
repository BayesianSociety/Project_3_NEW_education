import { notFound } from 'next/navigation';
import { getPuzzleById } from '@/data/puzzles';
import PuzzleExperience from '@/components/PuzzleExperience';

interface LevelPageProps {
  params: Promise<{ id: string }>;
}

export default async function LevelPage({ params }: LevelPageProps) {
  const { id } = await params;
  const puzzle = getPuzzleById(id);
  if (!puzzle) {
    notFound();
  }

  return <PuzzleExperience puzzle={puzzle} />;
}
