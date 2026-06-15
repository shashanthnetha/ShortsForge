import { useState, useEffect, useRef } from 'react';
import { 
  Video, Sliders, Play, Key, FolderOpen, Plus, Trash, 
  AlertCircle, CheckCircle, Terminal, StopCircle, Eye, EyeOff, 
  Save, RefreshCw, ChevronRight, X, Clock, PlayCircle, Upload,
  ExternalLink
} from 'lucide-react';

interface Variant {
  lang: string;
  label: string;
  tts_voice: string;
  caption_font: string;
  caption_font_name: string;
  yt_token_env: string;
  min_words: number;
}

interface ChannelPreset {
  id: string;
  label: string;
  groq_system_hint: string;
  segment_count: number;
  topic_pool: string[];
  image_style_suffix?: string;
  image_negative_prompt?: string;
  language?: string;
  tts_voice?: string;
  caption_font?: string;
  caption_font_name?: string;
  min_words?: number;
  visual_mode?: string;
  variants?: Variant[];
  topic_rotation?: string;
  yt_token_env?: string;
  extra_yt_token_envs?: string[];
}

interface Run {
  id: string;
  channel: string;
  timestamp: string;
  has_video: boolean;
  has_script: boolean;
  has_images: boolean;
  path: string;
}

interface RunDetail {
  id: string;
  script: any;
  images: string[];
  videos: string[];
  audios: string[];
}

interface BotProgress {
  activeStep: number;
  detailText: string;
  subprogress: number;
}

const getBotProgress = (logs: string[]): BotProgress => {
  let activeStep = 0;
  let detailText = 'Console idle. Ready to generate.';
  let subprogress = 0;

  for (const log of logs) {
    if (log.includes('Groq: generating script')) {
      activeStep = 1;
      detailText = 'Generating story script and image prompts via Groq...';
    } else if (log.includes('Images:') || log.includes('Videos:')) {
      activeStep = 2;
      detailText = 'Generating scene assets via DeAPI...';
    } else if (log.includes('scene ')) {
      activeStep = 2;
      const match = log.match(/scene (\d+)\/(\d+)/);
      if (match) {
        const current = parseInt(match[1]);
        const total = parseInt(match[2]);
        subprogress = Math.round((current / total) * 100);
        detailText = `Generating scene ${current} of ${total} (${subprogress}%)`;
      }
    } else if (log.includes('Edge TTS') || log.includes('synthesizing')) {
      activeStep = 3;
      detailText = 'Synthesizing voiceover narration...';
    } else if (log.includes('FFmpeg: rendering')) {
      activeStep = 4;
      detailText = 'Rendering vertical 9:16 video using FFmpeg...';
    } else if (log.includes('YouTube: uploading')) {
      activeStep = 5;
      detailText = 'Uploading Shorts video to YouTube...';
    } else if (log.includes('✓ Done.') || log.includes('✓ Execution finished.')) {
      activeStep = 6;
      detailText = 'Shorts generation completed successfully!';
    }
  }

  return { activeStep, detailText, subprogress };
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'niches' | 'runner' | 'config'>('home');
  const [presets, setPresets] = useState<Record<string, ChannelPreset>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Runner Tab State
  const [runChannel, setRunChannel] = useState('');
  const [runTopic, setRunTopic] = useState('');
  const [runUpload, setRunUpload] = useState(false);
  const [runPrivacy, setRunPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [runVisualMode, setRunVisualMode] = useState<'image' | 'video'>('image');
  const [botRunning, setBotRunning] = useState(false);
  const [botLogs, setBotLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Preset Editor Tab State
  const [editingPresetId, setEditingPresetId] = useState<string>('');
  const [presetForm, setPresetForm] = useState<ChannelPreset | null>(null);
  const [newTopicInput, setNewTopicInput] = useState('');

  // Config Tab State
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});

  // Loading States
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Inspector Manual Upload State
  const [manualUploadPrivacy, setManualUploadPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [manualUploading, setManualUploading] = useState(false);
  const [manualUploadUrls, setManualUploadUrls] = useState<string[]>([]);

  // Reset manual upload state when selected run changes
  useEffect(() => {
    setManualUploadUrls([]);
    setManualUploadPrivacy('private');
  }, [selectedRun]);

  // Fetch initial data
  useEffect(() => {
    fetchPresets();
    fetchRuns();
    fetchConfig();
    checkBotStatus();
  }, []);

  // Poll logs if bot is running
  useEffect(() => {
    let interval: any;
    if (botRunning) {
      interval = setInterval(() => {
        checkBotStatus();
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [botRunning]);

  // Scroll to bottom of logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [botLogs]);

  const fetchPresets = async () => {
    try {
      const res = await fetch('/api/presets');
      if (res.ok) {
        const data = await res.json();
        setPresets(data);
        if (Object.keys(data).length > 0 && !runChannel) {
          const firstKey = Object.keys(data)[0];
          setRunChannel(firstKey);
          setRunVisualMode(data[firstKey].visual_mode || 'image');
        }
      }
    } catch (err) {
      showError('Failed to fetch presets');
    }
  };

  const fetchRuns = async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch('/api/runs');
      if (res.ok) {
        const data = await res.json();
        setRuns(data);
      }
    } catch (err) {
      showError('Failed to fetch historical runs');
    } finally {
      setLoadingRuns(false);
    }
  };

  const fetchConfig = async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setConfigForm(data);
      }
    } catch (err) {
      showError('Failed to fetch configuration');
    } finally {
      setLoadingConfig(false);
    }
  };

  const checkBotStatus = async () => {
    try {
      const res = await fetch('/api/runs/status');
      if (res.ok) {
        const data = await res.json();
        setBotRunning(data.running);
        if (data.logs && data.logs.length > 0) {
          setBotLogs(data.logs);
        }
      }
    } catch (err) {
      // Fail silently for status polling
    }
  };

  const loadRunDetail = async (run: Run) => {
    setLoadingRunId(run.id);
    try {
      const res = await fetch(`/api/runs/${run.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedRun(data);
      } else {
        showError('Failed to load run details');
      }
    } catch (err) {
      showError('Error loading run details');
    } finally {
      setLoadingRunId(null);
    }
  };

  const triggerBotRun = async () => {
    if (!runChannel) return;
    setBotLogs(['Triggering run...']);
    setBotRunning(true);
    setActiveTab('runner');
    try {
      const res = await fetch('/api/runs/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: runChannel,
          topic: runTopic,
          upload: runUpload,
          privacy: runPrivacy,
          visual_mode: runVisualMode
        })
      });
      if (!res.ok) {
        const detail = await res.json();
        showError(detail.detail || 'Failed to start bot');
        setBotRunning(false);
      } else {
        showSuccess('Short generation triggered successfully!');
      }
    } catch (err) {
      showError('Error triggering run');
      setBotRunning(false);
    }
  };

  const cancelBotRun = async () => {
    try {
      const res = await fetch('/api/runs/cancel', { method: 'POST' });
      if (res.ok) {
        setBotRunning(false);
        showSuccess('Subprocess canceled');
        checkBotStatus();
      }
    } catch (err) {
      showError('Failed to cancel bot subprocess');
    }
  };

  const savePreset = async () => {
    if (!presetForm) return;
    try {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(presetForm)
      });
      if (res.ok) {
        showSuccess('Preset saved successfully');
        fetchPresets();
      } else {
        showError('Failed to save preset');
      }
    } catch (err) {
      showError('Error saving preset');
    }
  };

  const saveConfig = async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configForm)
      });
      if (res.ok) {
        showSuccess('Configuration saved successfully');
        fetchConfig();
      } else {
        showError('Failed to save configuration');
      }
    } catch (err) {
      showError('Error saving configuration');
    }
  };

  const startEditingPreset = (id: string) => {
    setEditingPresetId(id);
    setPresetForm(JSON.parse(JSON.stringify(presets[id])));
  };

  const createNewPreset = () => {
    const newId = `new_preset_${Date.now()}`;
    const newPreset: ChannelPreset = {
      id: newId,
      label: 'New Channel Preset',
      groq_system_hint: 'Write shorts about...',
      segment_count: 5,
      topic_pool: ['sample topic 1', 'sample topic 2'],
      language: 'en',
      tts_voice: 'en-US-ChristopherNeural',
      caption_font: 'BebasNeue-Regular.ttf',
      caption_font_name: 'Bebas Neue',
      visual_mode: 'image'
    };
    setPresets(prev => ({ ...prev, [newId]: newPreset }));
    startEditingPreset(newId);
  };

  const deletePreset = (id: string) => {
    if (!confirm('Are you sure you want to delete this preset from local cache? (Requires manual save to write changes)')) return;
    const updated = { ...presets };
    delete updated[id];
    setPresets(updated);
    if (editingPresetId === id) {
      setPresetForm(null);
      setEditingPresetId('');
    }
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 5000);
  };

  const handleManualUpload = async () => {
    if (!selectedRun || selectedRun.videos.length === 0) return;
    
    setManualUploading(true);
    setManualUploadUrls([]);
    
    try {
      const res = await fetch('/api/runs/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: selectedRun.id,
          video_filename: selectedRun.videos[0],
          channel: selectedRun.channel,
          privacy: manualUploadPrivacy
        })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        setManualUploadUrls(data.urls);
        showSuccess('Video uploaded successfully!');
      } else {
        showError(data.detail || 'Failed to upload video to YouTube');
      }
    } catch (err: any) {
      showError(err.message || 'An error occurred during upload');
    } finally {
      setManualUploading(false);
    }
  };

  const formatTimestamp = (ts: string) => {
    if (!ts || ts.length < 15) return ts;
    const year = ts.slice(0, 4);
    const month = ts.slice(4, 6);
    const day = ts.slice(6, 8);
    const hour = ts.slice(9, 11);
    const min = ts.slice(11, 13);
    const sec = ts.slice(13, 15);
    return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
  };

  const toggleTokenVisibility = (key: string) => {
    setShowTokens(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex h-screen bg-[#090b11] text-slate-100 overflow-hidden font-sans">
      
      {/* Toast notifications */}
      {errorMsg && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-red-950/80 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg shadow-xl backdrop-blur-md transition-all animate-bounce">
          <AlertCircle size={18} />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-purple-950/80 border border-purple-500/50 text-purple-200 px-4 py-3 rounded-lg shadow-xl backdrop-blur-md transition-all animate-pulse">
          <CheckCircle size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-64 bg-[#0d0f18] border-r border-slate-800/60 flex flex-col justify-between p-5">
        <div className="flex flex-col gap-6">
          {/* Logo / Header */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="p-2 bg-purple-600/20 text-purple-500 rounded-xl border border-purple-500/30 glow-accent">
              <Video className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white leading-none">ShortsForge</h1>
              <p className="text-[11px] text-purple-400 font-semibold uppercase tracking-widest mt-1">AI Video Engine</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1.5">
            <button
              onClick={() => setActiveTab('home')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'home' 
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <FolderOpen size={18} />
              <span>Runs & History</span>
            </button>
            <button
              onClick={() => setActiveTab('niches')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'niches' 
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Sliders size={18} />
              <span>Channel Niches</span>
            </button>
            <button
              onClick={() => setActiveTab('runner')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative ${
                activeTab === 'runner' 
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Play size={18} />
              <span>Run generator</span>
              {botRunning && (
                <span className="absolute right-3 top-3.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'config' 
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Key size={18} />
              <span>Secrets (.env)</span>
            </button>
          </nav>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 p-3 bg-slate-900/40 rounded-xl border border-slate-800/40">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Bot Service</span>
            <span className={`flex items-center gap-1 font-semibold ${botRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${botRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              {botRunning ? 'Active' : 'Idle'}
            </span>
          </div>
          {botRunning && (
            <button 
              onClick={cancelBotRun}
              className="flex items-center justify-center gap-1.5 mt-2 py-1.5 bg-red-950/50 hover:bg-red-900 border border-red-500/30 text-red-200 text-xs font-medium rounded-lg transition-all"
            >
              <StopCircle size={14} />
              <span>Kill Subprocess</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#0a0c12]">
        
        {/* Top bar header */}
        <header className="h-16 border-b border-slate-800/50 flex items-center justify-between px-8 bg-[#0d0f18]/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">Dashboard</span>
            <ChevronRight size={14} className="text-slate-600" />
            <span className="text-white text-sm font-semibold capitalize">{activeTab}</span>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                fetchPresets();
                fetchRuns();
                fetchConfig();
                checkBotStatus();
                showSuccess("Refreshed all data");
              }}
              className="p-2 text-slate-400 hover:text-white bg-slate-800/40 border border-slate-800 hover:border-slate-700 rounded-lg transition-all"
              title="Refresh Dashboard Data"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>

        {/* Content Container */}
        <div className="flex-1 overflow-y-auto p-8">
          
          {/* TAB 1: RUNS & HISTORY */}
          {activeTab === 'home' && (
            <div className="flex flex-col gap-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-white">Recent Generations</h2>
                  <p className="text-sm text-slate-400">View recent outputs, preview scripts, and watch rendered shorts.</p>
                </div>
              </div>

              {loadingRuns && runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
                  <span className="text-slate-400 text-sm">Loading historical runs...</span>
                </div>
              ) : runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 border border-dashed border-slate-800 rounded-xl bg-slate-900/10">
                  <Video size={48} className="text-slate-600 mb-2" />
                  <span className="text-slate-400 text-sm font-medium">No outputs generated yet</span>
                  <p className="text-slate-500 text-xs mt-1">Start a run to generate your first YouTube Short!</p>
                  <button 
                    onClick={() => setActiveTab('runner')}
                    className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-500 transition-all glow-accent"
                  >
                    Go to Runner
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {runs.map((run) => (
                    <div 
                      key={run.id}
                      className="bg-[#0e111a] border border-slate-800/80 hover:border-purple-500/40 rounded-xl overflow-hidden transition-all hover:scale-[1.01] hover:shadow-xl group"
                    >
                      <div className="p-5 flex flex-col justify-between h-48">
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className="px-2.5 py-1 bg-purple-950/40 text-purple-300 border border-purple-500/20 rounded-full text-xs font-semibold capitalize">
                              {run.channel.replace('_', ' ')}
                            </span>
                            <span className="flex items-center gap-1 text-[11px] text-slate-500">
                              <Clock size={12} />
                              {formatTimestamp(run.timestamp)}
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-slate-200 line-clamp-2 leading-snug group-hover:text-white">
                            {run.id}
                          </h3>
                        </div>

                        <div className="flex items-center justify-between pt-4 border-t border-slate-800/60">
                          {/* File status indicators */}
                          <div className="flex gap-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded border ${run.has_video ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-400' : 'bg-slate-950/30 border-slate-800 text-slate-600'}`}>MP4</span>
                            <span className={`text-xs px-2 py-0.5 rounded border ${run.has_script ? 'bg-sky-950/25 border-sky-500/30 text-sky-400' : 'bg-slate-950/30 border-slate-800 text-slate-600'}`}>Script</span>
                            <span className={`text-xs px-2 py-0.5 rounded border ${run.has_images ? 'bg-indigo-950/25 border-indigo-500/30 text-indigo-400' : 'bg-slate-950/30 border-slate-800 text-slate-600'}`}>PNGs</span>
                          </div>

                          <button
                            onClick={() => loadRunDetail(run)}
                            disabled={loadingRunId === run.id}
                            className="flex items-center gap-1 text-xs font-semibold text-purple-400 hover:text-purple-300 transition-all cursor-pointer"
                          >
                            {loadingRunId === run.id ? (
                              <RefreshCw size={14} className="animate-spin" />
                            ) : (
                              <>
                                <span>Inspect</span>
                                <ChevronRight size={14} />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CHANNEL NICHES (PRESETS) */}
          {activeTab === 'niches' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Presets Sidebar List */}
              <div className="bg-[#0e111a] border border-slate-800/80 rounded-xl p-5 flex flex-col gap-4">
                <div className="flex justify-between items-center pb-3 border-b border-slate-800/60">
                  <h3 className="font-bold text-white text-base">Channel Presets</h3>
                  <button 
                    onClick={createNewPreset}
                    className="flex items-center gap-1 py-1 px-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-all"
                  >
                    <Plus size={14} />
                    <span>Create</span>
                  </button>
                </div>
                <div className="flex flex-col gap-1 max-h-[500px] overflow-y-auto pr-1">
                  {Object.keys(presets).map((id) => (
                    <div 
                      key={id}
                      className={`flex justify-between items-center p-3 rounded-lg text-sm font-medium transition-all group ${
                        editingPresetId === id 
                          ? 'bg-purple-950/35 border border-purple-500/30 text-purple-300 shadow-md' 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent'
                      }`}
                    >
                      <button 
                        onClick={() => startEditingPreset(id)}
                        className="flex-1 text-left font-bold"
                      >
                        {presets[id].label || id}
                        <span className="block text-[11px] text-slate-500 font-mono mt-0.5">{id}</span>
                      </button>
                      
                      <button 
                        onClick={() => deletePreset(id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/20 rounded-md transition-all ml-2"
                        title="Delete Preset"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preset Editor Pane */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                {presetForm ? (
                  <div className="bg-[#0e111a] border border-slate-800/80 rounded-xl p-6 flex flex-col gap-5">
                    <div className="flex justify-between items-center border-b border-slate-800/60 pb-4">
                      <div>
                        <h3 className="font-bold text-lg text-white">Preset Editor</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Preset ID: <code className="text-slate-400">{presetForm.id}</code></p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setPresetForm(null)}
                          className="px-4 py-2 bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold rounded-lg transition-all"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={savePreset}
                          className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-all glow-accent"
                        >
                          <Save size={14} />
                          <span>Save to file</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Channel Name/Label</label>
                        <input 
                          type="text" 
                          value={presetForm.label}
                          onChange={(e) => setPresetForm({ ...presetForm, label: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Segment Count (Beats)</label>
                        <input 
                          type="number" 
                          value={presetForm.segment_count}
                          onChange={(e) => setPresetForm({ ...presetForm, segment_count: parseInt(e.target.value) || 5 })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Default Visual Mode</label>
                        <select
                          value={presetForm.visual_mode || 'image'}
                          onChange={(e) => setPresetForm({ ...presetForm, visual_mode: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                        >
                          <option value="image">Still Images</option>
                          <option value="video">DeAPI Video Clips</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Groq System Prompt / Niche Directives</label>
                      <textarea 
                        rows={6}
                        value={presetForm.groq_system_hint}
                        onChange={(e) => setPresetForm({ ...presetForm, groq_system_hint: e.target.value })}
                        className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-purple-500 leading-relaxed"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Image Style Suffix</label>
                        <textarea 
                          rows={3}
                          value={presetForm.image_style_suffix || ''}
                          onChange={(e) => setPresetForm({ ...presetForm, image_style_suffix: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Negative Prompt</label>
                        <textarea 
                          rows={3}
                          value={presetForm.image_negative_prompt || ''}
                          onChange={(e) => setPresetForm({ ...presetForm, image_negative_prompt: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">TTS Voice (Edge TTS)</label>
                        <input 
                          type="text" 
                          value={presetForm.tts_voice || ''}
                          onChange={(e) => setPresetForm({ ...presetForm, tts_voice: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Caption Font File</label>
                        <input 
                          type="text" 
                          value={presetForm.caption_font || ''}
                          onChange={(e) => setPresetForm({ ...presetForm, caption_font: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Caption Font Name</label>
                        <input 
                          type="text" 
                          value={presetForm.caption_font_name || ''}
                          onChange={(e) => setPresetForm({ ...presetForm, caption_font_name: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    {/* Topic Pool Management */}
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Topic Pool</label>
                      <div className="flex gap-2 mb-3">
                        <input 
                          type="text" 
                          value={newTopicInput}
                          onChange={(e) => setNewTopicInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newTopicInput.trim()) {
                              e.preventDefault();
                              const topics = [...(presetForm.topic_pool || [])];
                              topics.push(newTopicInput.trim());
                              setPresetForm({ ...presetForm, topic_pool: topics });
                              setNewTopicInput('');
                            }
                          }}
                          placeholder="Type a topic and press enter or click Add..."
                          className="flex-1 bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                        />
                        <button
                          onClick={() => {
                            if (newTopicInput.trim()) {
                              const topics = [...(presetForm.topic_pool || [])];
                              topics.push(newTopicInput.trim());
                              setPresetForm({ ...presetForm, topic_pool: topics });
                              setNewTopicInput('');
                            }
                          }}
                          className="py-2 px-4 bg-slate-800 hover:bg-slate-700 border border-slate-750 text-slate-200 text-sm font-semibold rounded-lg transition-all"
                        >
                          Add
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-[#121420]/50 border border-slate-850 rounded-lg">
                        {(presetForm.topic_pool || []).map((topic, i) => (
                          <span 
                            key={i} 
                            className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 bg-slate-800 border border-slate-750 text-slate-300 rounded-md text-xs font-medium hover:border-red-500/30 group"
                          >
                            <span>{topic}</span>
                            <button
                              onClick={() => {
                                const topics = [...presetForm.topic_pool];
                                topics.splice(i, 1);
                                setPresetForm({ ...presetForm, topic_pool: topics });
                              }}
                              className="p-0.5 text-slate-500 hover:text-red-400 hover:bg-red-950/20 rounded transition-all"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                        {(presetForm.topic_pool || []).length === 0 && (
                          <span className="text-xs text-slate-500 p-1">No topics in pool. The rotation or random trigger will require --topic overrides.</span>
                        )}
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full border border-dashed border-slate-800 rounded-xl bg-slate-900/10 p-6 text-center">
                    <Sliders size={40} className="text-slate-600 mb-2" />
                    <span className="text-slate-400 text-sm font-medium">No Preset Selected</span>
                    <p className="text-slate-500 text-xs mt-1 max-w-xs">Select a preset on the sidebar or click Create to customize a channel's generator settings.</p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: TRIGGER BOT (RUNNER) */}
          {activeTab === 'runner' && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              
              {/* Trigger Options */}
              <div className="flex flex-col gap-6">
                <div className="bg-[#0e111a] border border-slate-800/80 rounded-xl p-5 flex flex-col gap-5">
                  <h3 className="font-bold text-white text-base border-b border-slate-850 pb-3">Bot Execution Controls</h3>
                  
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-400 mb-2">Target Channel Niche</label>
                    <select
                      value={runChannel}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRunChannel(val);
                        if (presets[val]) {
                          setRunVisualMode(presets[val].visual_mode || 'image');
                        }
                      }}
                      disabled={botRunning}
                      className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500 capitalize"
                    >
                      {Object.keys(presets).map((id) => (
                        <option key={id} value={id}>{presets[id].label || id}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-400 mb-2">Topic Hint (Optional Override)</label>
                    <input 
                      type="text"
                      placeholder="e.g. Bermuda Triangle mysteries"
                      value={runTopic}
                      onChange={(e) => setRunTopic(e.target.value)}
                      disabled={botRunning}
                      className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">If blank, picks a random topic from the channel's pool.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-400 mb-2">Visual Generation Mode</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRunVisualMode('image')}
                        disabled={botRunning}
                        className={`py-2.5 px-3 text-xs font-bold uppercase rounded-lg border transition-all flex items-center justify-center gap-1.5 ${
                          runVisualMode === 'image'
                            ? 'bg-purple-650/15 border-purple-500 text-purple-400 font-bold shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                            : 'bg-[#121420] border-slate-800 text-slate-400 hover:border-slate-700 font-semibold'
                        }`}
                      >
                        <span>🖼️ Still Images</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRunVisualMode('video')}
                        disabled={botRunning}
                        className={`py-2.5 px-3 text-xs font-bold uppercase rounded-lg border transition-all flex items-center justify-center gap-1.5 ${
                          runVisualMode === 'video'
                            ? 'bg-purple-650/15 border-purple-500 text-purple-400 font-bold shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                            : 'bg-[#121420] border-slate-800 text-slate-400 hover:border-slate-700 font-semibold'
                        }`}
                      >
                        <span>🎥 Video Clips</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5 leading-normal">
                      {runVisualMode === 'image'
                        ? 'Generates high-quality images via Flux Klein and applies Ken Burns zooming in FFmpeg.'
                        : 'Generates actual 24fps motion videos using LTX-2.3 22B model via DeAPI.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 py-1 bg-slate-900/40 px-3 rounded-lg border border-slate-850">
                    <input 
                      type="checkbox"
                      id="upload_cb"
                      checked={runUpload}
                      onChange={(e) => setRunUpload(e.target.checked)}
                      disabled={botRunning}
                      className="rounded border-slate-800 text-purple-600 focus:ring-purple-500 h-4 w-4 bg-[#121420]"
                    />
                    <label htmlFor="upload_cb" className="text-sm text-slate-300 font-semibold cursor-pointer">Upload directly to YouTube</label>
                  </div>

                  {runUpload && (
                    <div className="border border-slate-850 bg-slate-900/35 rounded-lg p-3.5 flex flex-col gap-2.5">
                      <label className="block text-[11px] font-bold uppercase text-slate-400">YouTube Upload Visibility</label>
                      <div className="flex gap-4">
                        {['private', 'unlisted', 'public'].map((privacy) => (
                          <label key={privacy} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                            <input 
                              type="radio" 
                              name="privacy" 
                              value={privacy}
                              checked={runPrivacy === privacy}
                              onChange={() => setRunPrivacy(privacy as any)}
                              className="text-purple-600 focus:ring-purple-500 h-3 w-3 bg-[#121420]"
                            />
                            <span className="capitalize">{privacy}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2">
                    {botRunning ? (
                      <button
                        onClick={cancelBotRun}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-red-650 hover:bg-red-600 text-white font-bold rounded-lg transition-all"
                      >
                        <StopCircle size={18} />
                        <span>Kill Bot Generation</span>
                      </button>
                    ) : (
                      <button
                        onClick={triggerBotRun}
                        disabled={!runChannel}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-lg transition-all glow-accent"
                      >
                        <Play size={18} />
                        <span>Run Generation Bot</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-[#0e111a] border border-slate-800/80 rounded-xl p-4 flex gap-3.5 items-start">
                  <Terminal size={20} className="text-purple-400 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-slate-300 uppercase">Ffmpeg Burn-In Note</h4>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">Ensure FFmpeg is installed and configured on your path (`brew install ffmpeg` / `sudo apt install ffmpeg`). Burn-in subtitles draw from presets font settings.</p>
                  </div>
                </div>
              </div>

              {/* Console Logger */}
              <div className="xl:col-span-2 flex flex-col min-h-[500px]">
                <div className="bg-[#0b0c10] border border-slate-850 rounded-xl flex-1 flex flex-col overflow-hidden shadow-2xl">
                  {/* Console Header */}
                  <div className="bg-[#121420] border-b border-slate-850 px-5 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-red-500/80" />
                        <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
                        <span className="w-3 h-3 rounded-full bg-green-500/80" />
                      </div>
                      <span className="text-xs font-bold text-slate-400 font-mono tracking-tight ml-2">Console Logs (run_short.log)</span>
                    </div>

                    <button 
                      onClick={() => setBotLogs([])}
                      className="text-[10px] text-slate-500 hover:text-slate-300 font-semibold px-2 py-1 bg-slate-900 border border-slate-850 rounded transition-all"
                    >
                      Clear Logs
                    </button>
                  </div>

                  {/* Real-time Progress Stepper */}
                  {(botRunning || botLogs.length > 0) && (() => {
                    const progress = getBotProgress(botLogs);
                    const steps = [
                      { id: 1, name: 'Script' },
                      { id: 2, name: 'Visuals' },
                      { id: 3, name: 'Voice' },
                      { id: 4, name: 'Render' },
                      { id: 5, name: 'Upload' },
                      { id: 6, name: 'Done' }
                    ];

                    return (
                      <div className="bg-[#121420]/40 border-b border-slate-850 p-5 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">ShortsForge Pipeline</span>
                          <span className="text-xs text-purple-400 font-semibold">{progress.detailText}</span>
                        </div>
                        
                        {/* Stepper Steps */}
                        <div className="flex items-center justify-between relative mt-2 px-2">
                          {/* Connection line */}
                          <div className="absolute left-6 right-6 top-1/2 h-0.5 bg-slate-850 -translate-y-1/2 z-0" />
                          <div 
                            className="absolute left-6 top-1/2 h-0.5 bg-purple-600 -translate-y-1/2 z-0 transition-all duration-500" 
                            style={{ 
                              width: `${progress.activeStep > 0 ? ((Math.min(progress.activeStep, 6) - 1) / 5) * 100 : 0}%` 
                            }} 
                          />

                          {steps.map((step) => {
                            const isCompleted = progress.activeStep > step.id || (progress.activeStep === 6 && step.id === 6);
                            const isActive = progress.activeStep === step.id;

                            return (
                              <div key={step.id} className="flex flex-col items-center z-10 relative">
                                <div 
                                  className={`w-8 h-8 rounded-full flex items-center justify-center border font-mono text-xs transition-all duration-300 ${
                                    isCompleted 
                                      ? 'bg-purple-600 border-purple-500 text-white shadow-md shadow-purple-600/30' 
                                      : isActive 
                                      ? 'bg-slate-900 border-purple-500 text-purple-400 font-bold scale-110 ring-4 ring-purple-600/20' 
                                      : 'bg-[#0b0c10] border-slate-800 text-slate-500'
                                  }`}
                                >
                                  {isCompleted ? (
                                    <CheckCircle size={14} className="stroke-[3]" />
                                  ) : isActive && step.id === 2 && progress.subprogress > 0 ? (
                                    <span>{progress.subprogress}%</span>
                                  ) : (
                                    <span>{step.id}</span>
                                  )}
                                </div>
                                <span 
                                  className={`text-[10px] mt-1.5 font-bold tracking-tight uppercase ${
                                    isCompleted || isActive ? 'text-slate-200' : 'text-slate-500'
                                  }`}
                                >
                                  {step.name}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Log Body */}
                  <div className="flex-1 overflow-y-auto p-5 font-mono text-[13px] text-slate-300 bg-[#07080c] leading-relaxed flex flex-col gap-1.5 max-h-[600px]">
                    {botLogs.map((log, i) => (
                      <div 
                        key={i} 
                        className={`${
                          log.includes('⚠') ? 'text-amber-300 font-medium' : 
                          log.includes('ERROR') || log.includes('failed') ? 'text-red-400 font-semibold' : 
                          log.includes('✓') || log.includes('Done') || log.includes('Uploaded') ? 'text-emerald-400 font-semibold' : 
                          log.includes('━━━') ? 'text-purple-400 font-bold border-y border-slate-900 py-1 my-1' :
                          'text-slate-350'
                        }`}
                      >
                        {log}
                      </div>
                    ))}
                    {botLogs.length === 0 && (
                      <div className="text-slate-600 italic text-center py-20">Console idle. Logs will stream here during a generation run.</div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 4: API SECRETS CONFIG */}
          {activeTab === 'config' && (
            <div className="max-w-3xl flex flex-col gap-6">
              <div className="flex justify-between items-center pb-2 border-b border-slate-850">
                <div>
                  <h2 className="text-2xl font-bold text-white">Environment Configuration</h2>
                  <p className="text-sm text-slate-400">Safely configure API tokens and OAuth variables in your project's `.env` file.</p>
                </div>

                <button 
                  onClick={saveConfig}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-lg transition-all glow-accent"
                >
                  <Save size={16} />
                  <span>Save configuration</span>
                </button>
              </div>

              {loadingConfig && Object.keys(configForm).length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
                  <span className="text-slate-400 text-sm">Loading config...</span>
                </div>
              ) : (
                <div className="bg-[#0e111a] border border-slate-800/80 rounded-xl p-6 flex flex-col gap-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-5 border-b border-slate-850">
                    <div>
                      <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3">Groq (Required)</h4>
                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">GROQ_API_KEY</label>
                          <div className="flex relative">
                            <input 
                              type={showTokens['GROQ_API_KEY'] ? 'text' : 'password'}
                              value={configForm['GROQ_API_KEY'] || ''}
                              onChange={(e) => setConfigForm({ ...configForm, GROQ_API_KEY: e.target.value })}
                              className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 pl-3 pr-10 text-sm font-mono focus:outline-none focus:border-purple-500"
                            />
                            <button
                              onClick={() => toggleTokenVisibility('GROQ_API_KEY')}
                              className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                            >
                              {showTokens['GROQ_API_KEY'] ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">GROQ_MODEL</label>
                          <input 
                            type="text"
                            value={configForm['GROQ_MODEL'] || 'llama-3.3-70b-versatile'}
                            onChange={(e) => setConfigForm({ ...configForm, GROQ_MODEL: e.target.value })}
                            className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-purple-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3">DeAPI.ai (Images)</h4>
                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">DEAPI_TOKEN</label>
                          <div className="flex relative">
                            <input 
                              type={showTokens['DEAPI_TOKEN'] ? 'text' : 'password'}
                              value={configForm['DEAPI_TOKEN'] || ''}
                              onChange={(e) => setConfigForm({ ...configForm, DEAPI_TOKEN: e.target.value })}
                              className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 pl-3 pr-10 text-sm font-mono focus:outline-none focus:border-purple-500"
                            />
                            <button
                              onClick={() => toggleTokenVisibility('DEAPI_TOKEN')}
                              className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                            >
                              {showTokens['DEAPI_TOKEN'] ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">DEAPI_MODEL</label>
                          <input 
                            type="text"
                            value={configForm['DEAPI_MODEL'] || 'Flux_2_Klein_4B_BF16'}
                            onChange={(e) => setConfigForm({ ...configForm, DEAPI_MODEL: e.target.value })}
                            className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-purple-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider">YouTube OAuth Credentials</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">YT_CLIENT_SECRET</label>
                        <input 
                          type="text"
                          value={configForm['YT_CLIENT_SECRET'] || 'secrets/client_secret.json'}
                          onChange={(e) => setConfigForm({ ...configForm, YT_CLIENT_SECRET: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">YT_TOKEN</label>
                        <input 
                          type="text"
                          value={configForm['YT_TOKEN'] || 'secrets/youtube_token.json'}
                          onChange={(e) => setConfigForm({ ...configForm, YT_TOKEN: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">YT_REFRESH_TOKEN</label>
                      <div className="flex relative">
                        <input 
                          type={showTokens['YT_REFRESH_TOKEN'] ? 'text' : 'password'}
                          value={configForm['YT_REFRESH_TOKEN'] || ''}
                          onChange={(e) => setConfigForm({ ...configForm, YT_REFRESH_TOKEN: e.target.value })}
                          className="w-full bg-[#121420] border border-slate-800 rounded-lg py-2 pl-3 pr-10 text-sm font-mono focus:outline-none focus:border-purple-500"
                        />
                        <button
                          onClick={() => toggleTokenVisibility('YT_REFRESH_TOKEN')}
                          className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                        >
                          {showTokens['YT_REFRESH_TOKEN'] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* INSPECTOR SLIDE-OVER / MODAL */}
      {selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-4xl h-full bg-[#0d0f18] border-l border-slate-850 flex flex-col shadow-2xl relative animate-in slide-in-from-right duration-350">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-850 flex items-center justify-between bg-[#121420]">
              <div>
                <span className="text-xs uppercase text-purple-400 font-bold tracking-widest font-mono">Run Inspector</span>
                <h2 className="text-lg font-bold text-white mt-0.5">{selectedRun.id}</h2>
              </div>
              <button 
                onClick={() => setSelectedRun(null)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col lg:flex-row gap-6">
              
              {/* Left Column: Script / Prompt details */}
              <div className="flex-1 flex flex-col gap-6">
                
                {/* Generated Script Content */}
                <div className="bg-[#121420]/50 border border-slate-850 rounded-xl p-5 flex flex-col gap-4">
                  <h3 className="font-bold text-slate-200 text-sm border-b border-slate-850 pb-2">Generation Script (JSON)</h3>
                  
                  {selectedRun.script && Object.keys(selectedRun.script).length > 0 ? (
                    <div className="flex flex-col gap-4">
                      <div>
                        <span className="block text-[10px] text-slate-500 uppercase font-bold">YouTube Title</span>
                        <h4 className="text-sm font-bold text-slate-200 mt-1">{selectedRun.script.youtube_title || 'N/A'}</h4>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500 uppercase font-bold">Full Narration (Spoken Text)</span>
                        <p className="text-xs text-slate-300 mt-1.5 leading-relaxed bg-slate-950/45 p-3 rounded-lg border border-slate-900 font-mono">
                          {selectedRun.script.full_narration || 'N/A'}
                        </p>
                      </div>

                      {/* Scene Beats */}
                      <div>
                        <span className="block text-[10px] text-slate-500 uppercase font-bold mb-2">Story Scene Beats</span>
                        <div className="flex flex-col gap-2">
                          {(selectedRun.script.image_prompts || []).map((prompt: string, i: number) => (
                            <div key={i} className="flex gap-3 bg-slate-950/20 border border-slate-900 rounded-lg p-2.5 text-xs text-slate-350">
                              <span className="font-mono text-purple-400 font-semibold">{i + 1}</span>
                              <p className="leading-normal">{prompt}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 italic p-4 text-center">No script.json file found for this run.</div>
                  )}
                </div>
              </div>

              {/* Right Column: Video & Media Assets */}
              <div className="w-full lg:w-80 flex flex-col gap-6">
                
                {/* MP4 Player */}
                <div className="bg-[#121420]/50 border border-slate-850 rounded-xl p-4 flex flex-col gap-3">
                  <h3 className="font-bold text-slate-200 text-sm flex items-center gap-1.5">
                    <PlayCircle size={16} className="text-purple-400" />
                    <span>Video Render</span>
                  </h3>
                  
                  {selectedRun.videos.length > 0 ? (
                    <div className="aspect-[9/16] bg-black rounded-lg overflow-hidden border border-slate-900 shadow-lg relative group">
                      <video 
                        controls
                        src={`/api/runs/${selectedRun.id}/files/${selectedRun.videos[0]}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="aspect-[9/16] bg-slate-950/50 border border-slate-900 border-dashed rounded-lg flex flex-col items-center justify-center p-4 text-center">
                      <Video size={32} className="text-slate-750 mb-2" />
                      <span className="text-xs text-slate-400 font-medium">Video Render Missing</span>
                      <p className="text-[10px] text-slate-600 mt-0.5">Short video was not generated or failed to compile.</p>
                    </div>
                  )}
                </div>

                {/* Upload to YouTube Card */}
                {selectedRun.videos.length > 0 && (
                  <div className="bg-[#121420]/50 border border-slate-850 rounded-xl p-4 flex flex-col gap-3">
                    <h3 className="font-bold text-slate-200 text-sm flex items-center gap-1.5">
                      <Upload size={16} className="text-purple-400" />
                      <span>Upload to YouTube</span>
                    </h3>
                    
                    <div className="flex flex-col gap-2.5">
                      <div>
                        <label className="block text-[10px] text-slate-450 uppercase font-bold mb-1">Privacy Status</label>
                        <select
                          value={manualUploadPrivacy}
                          onChange={(e) => setManualUploadPrivacy(e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                        >
                          <option value="private">Private</option>
                          <option value="unlisted">Unlisted</option>
                          <option value="public">Public</option>
                        </select>
                      </div>

                      <button
                        onClick={handleManualUpload}
                        disabled={manualUploading}
                        className={`w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                          manualUploading
                            ? 'bg-purple-900/40 text-purple-300 border border-purple-800/40 cursor-not-allowed'
                            : 'bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/15'
                        }`}
                      >
                        {manualUploading ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            <span>Uploading video...</span>
                          </>
                        ) : (
                          <>
                            <Upload size={14} />
                            <span>Upload Video</span>
                          </>
                        )}
                      </button>

                      {manualUploadUrls.length > 0 && (
                        <div className="mt-2 p-2.5 bg-emerald-950/20 border border-emerald-900/35 rounded-lg flex flex-col gap-1.5 animate-in fade-in duration-300">
                          <span className="text-[10px] text-emerald-450 font-bold uppercase">Uploaded Successfully!</span>
                          {manualUploadUrls.map((url, i) => (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-purple-400 hover:text-purple-300 underline flex items-center gap-1"
                            >
                              <span>Channel Video {i + 1}</span>
                              <ExternalLink size={10} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Generated Scene Images */}
                <div className="bg-[#121420]/50 border border-slate-850 rounded-xl p-4 flex flex-col gap-3">
                  <h3 className="font-bold text-slate-200 text-sm">Generated Images ({selectedRun.images.length})</h3>
                  
                  {selectedRun.images.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                      {selectedRun.images.map((imgName) => (
                        <div key={imgName} className="aspect-square bg-slate-950 rounded-lg overflow-hidden border border-slate-900 group relative">
                          <img 
                            src={`/api/runs/${selectedRun.id}/files/images/${imgName}`} 
                            alt={imgName}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 italic p-4 text-center">No images found.</div>
                  )}
                </div>

              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
