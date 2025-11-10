
import React, { useState } from 'react';

interface SettingsFormProps {
  onGenerate: (date: string, branch: string, interestingKeywords: string) => void;
  isLoading: boolean;
}

// Get today's date in YYYY-MM-DD format for the input default
const getTodayString = () => {
    const today = new Date();
    today.setDate(today.getDate() - 1); // Default to yesterday as today might not have many commits yet
    return today.toISOString().split('T')[0];
}

export const SettingsForm: React.FC<SettingsFormProps> = ({ onGenerate, isLoading }) => {
  const [date, setDate] = useState(getTodayString());
  const [branch, setBranch] = useState('main');
  const [interestingKeywords, setInterestingKeywords] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (date && branch) {
      onGenerate(date, branch, interestingKeywords);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="date" className="block text-sm font-medium text-gray-300 mb-2">
            Select Date
          </label>
          <input
            type="date"
            id="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 p-2"
            required
          />
        </div>
        <div>
          <label htmlFor="branch" className="block text-sm font-medium text-gray-300 mb-2">
            Branch or Tag
          </label>
          <input
            type="text"
            id="branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="w-full bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 p-2"
            placeholder="e.g., main, 125.0.6422.0"
            required
          />
        </div>
        <div>
          <label htmlFor="interesting" className="block text-sm font-medium text-gray-300 mb-2">
            Interesting Keywords (comma-separated)
          </label>
          <textarea
            id="interesting"
            rows={3}
            value={interestingKeywords}
            onChange={(e) => setInterestingKeywords(e.target.value)}
            className="w-full bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 p-2"
            placeholder="e.g., performance, security, accessibility"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-gray-800 disabled:bg-sky-800 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? 'Generating...' : 'Generate Summary'}
        </button>
      </form>
    </div>
  );
};
