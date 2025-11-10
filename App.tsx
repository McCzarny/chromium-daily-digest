import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { SettingsForm } from './components/SettingsForm';
import { SummaryDisplay } from './components/SummaryDisplay';
import { Loader } from './components/Loader';
import { fetchCommitsForDate } from './services/chromiumService';
import { generateSummary } from './services/geminiService';
import { GitilesCommit, StructuredSummary } from './types';

function App() {
  const [summary, setSummary] = useState<StructuredSummary | null>(null);
  const [allCommits, setAllCommits] = useState<GitilesCommit[]>([]);
  const [filteredCommits, setFilteredCommits] = useState<GitilesCommit[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateSummary = useCallback(async (
    date: string,
    branch: string,
    interestingKeywords: string
  ) => {
    setIsLoading(true);
    setError(null);
    setSummary(null);
    setAllCommits([]);
    setFilteredCommits([]);

    try {
      const commits = await fetchCommitsForDate(date, branch);
      setAllCommits(commits);
      
      if (!commits || commits.length === 0) {
        setError(`No commits found for ${date} on branch '${branch}'.`);
        setIsLoading(false);
        return;
      }

      const totalCommitsCount = commits.length;
      
      const relevantCommits = commits.filter(commit => {
        const message = commit.message;
        const firstLine = message.split('\n')[0];
        
        // Check if message starts with "Roll" (case-insensitive)
        if (/^roll\s/i.test(firstLine)) {
          return false;
        }
        
        // Check if message indicates a version update
        if (/updating\s+(trunk\s+)?version\s+from/i.test(firstLine)) {
          return false;
        }
        
        return true;
      });
      setFilteredCommits(relevantCommits);

      if (relevantCommits.length === 0) {
        setError(`All commits for ${date} were filtered out.`);
        setIsLoading(false);
        return;
      }

      const relevantCommitsCount = relevantCommits.length;
      const firstCommit = relevantCommits[relevantCommits.length - 1]; 
      const lastCommit = relevantCommits[0];
      
      const generatedSummary = await generateSummary(
        relevantCommits, 
        interestingKeywords, 
        date, 
        branch,
        totalCommitsCount,
        relevantCommitsCount,
        firstCommit,
        lastCommit
      );
      setSummary(generatedSummary);

    } catch (err) {
      if (err instanceof Error) {
        setError(`An error occurred: ${err.message}`);
      } else {
        setError('An unknown error occurred.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <SettingsForm onGenerate={handleGenerateSummary} isLoading={isLoading} />
          </div>
          <div className="lg:col-span-2">
            <div className="bg-gray-800 p-6 rounded-lg shadow-lg min-h-[400px] flex flex-col justify-center items-center">
              {isLoading && <Loader />}
              {error && <div className="text-red-400 bg-red-900/50 p-4 rounded-md text-center">{error}</div>}
              {summary && !isLoading && (
                <SummaryDisplay 
                  summary={summary} 
                  allCommits={allCommits} 
                  filteredCommits={filteredCommits} 
                />
              )}
              {!isLoading && !error && !summary && (
                <div className="text-center text-gray-500">
                  <h2 className="text-2xl font-semibold mb-2">Welcome!</h2>
                  <p>Fill in the details on the left and click "Generate" to create your Chromium change summary.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
