import { useState, useEffect, useRef } from 'react';
import { 
  Video, Sliders, Play, Key, FolderOpen, Plus, Trash, 
  AlertCircle, CheckCircle, Terminal, StopCircle, Eye, EyeOff, 
  Save, RefreshCw, ChevronRight, X, Clock, PlayCircle, Upload,
  ExternalLink, BarChart2
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
  first_image?: string;
  path: string;
}

interface RunDetail {
  id: string;
  script: any;
  images: string[];
  videos: string[];
  audios: string[];
  channel?: string;
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

const PRESET_EMOJIS = ['🌌', '💡', '👻', '📜', '⚡', '🤖', '⚔️', '🧘', '🎨', '🍿', '🚀', '🎭', '🧠', '🦖', '🗺️', '💸', '⚽', '🍔'];

const getPresetCategoryAndEmoji = (preset: ChannelPreset) => {
  const labelLower = (preset.label || '').toLowerCase();
  const idLower = (preset.id || '').toLowerCase();
  
  const category = preset.category || (
    idLower.includes('myth') || labelLower.includes('myth') || labelLower.includes('god') ? 'lore' :
    idLower.includes('fact') || labelLower.includes('fact') || labelLower.includes('curios') ? 'facts' :
    idLower.includes('scary') || labelLower.includes('horror') ? 'horror' :
    idLower.includes('hist') || labelLower.includes('past') ? 'history' :
    idLower.includes('tech') || labelLower.includes('future') ? 'tech' : 'other'
  );

  const emoji = preset.emoji || (
    category === 'lore' ? '🌌' :
    category === 'facts' ? '💡' :
    category === 'horror' ? '👻' :
    category === 'history' ? '📜' :
    category === 'tech' ? '⚡' : '🤖'
  );

  return { category, emoji };
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'niches' | 'runner' | 'config' | 'stats'>('home');
  const [presets, setPresets] = useState<Record<string, ChannelPreset>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Runner Tab State
  const [runChannel, setRunChannel] = useState('');
  const [runTopic, setRunTopic] = useState('');
  const [runLanguage, setRunLanguage] = useState('');
  const [runGender, setRunGender] = useState('');
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
  const [selectedNicheCategory, setSelectedNicheCategory] = useState<string>('all');
  const [editorSubTab, setEditorSubTab] = useState<'core' | 'ai' | 'media' | 'topics'>('core');

  // Config Tab State
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});

  // Stats Tab State
  const [statsChannel, setStatsChannel] = useState<string>('');
  const [channelStats, setChannelStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(false);
  const [statsMetric, setStatsMetric] = useState<'views' | 'subscribers' | 'revenue'>('views');
  const [hoveredPoint, setHoveredPoint] = useState<any>(null);

  // Loading States
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Inspector Manual Upload State
  const [manualUploadPrivacy, setManualUploadPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [manualUploading, setManualUploading] = useState(false);
  const [manualUploadUrls, setManualUploadUrls] = useState<string[]>([]);

  // Inspector Edit & Visual Timeline State
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editNarration, setEditNarration] = useState('');
  const [editPrompts, setEditPrompts] = useState<string[]>([]);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number>(0);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [regeneratingScene, setRegeneratingScene] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  
  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Reset manual upload state and initialize editing states when selected run changes
  useEffect(() => {
    setManualUploadUrls([]);
    setManualUploadPrivacy('private');

    if (selectedRun) {
      setEditTitle(selectedRun.script?.youtube_title || '');
      setEditDescription(selectedRun.script?.youtube_description || '');
      setEditNarration(selectedRun.script?.full_narration || '');
      setEditPrompts(selectedRun.script?.image_prompts || []);
      setSelectedSceneIndex(0);
      
      if (selectedRun.script?.variants && Object.keys(selectedRun.script.variants).length > 0) {
        const firstVar = Object.keys(selectedRun.script.variants)[0];
        setSelectedVariant(firstVar);
        setEditTitle(selectedRun.script.variants[firstVar].youtube_title || '');
        setEditDescription(selectedRun.script.variants[firstVar].youtube_description || '');
        setEditNarration(selectedRun.script.variants[firstVar].full_narration || '');
      } else {
        setSelectedVariant(null);
      }
    }
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

  const fetchStats = async (channelId: string) => {
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/stats?channel=${channelId}`);
      if (res.ok) {
        const data = await res.json();
        setChannelStats(data);
      } else {
        showError('Failed to fetch statistics');
      }
    } catch (err) {
      showError('Failed to fetch statistics');
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'stats' && statsChannel) {
      fetchStats(statsChannel);
    }
  }, [activeTab, statsChannel]);

  useEffect(() => {
    if (presets && Object.keys(presets).length > 0 && !statsChannel) {
      setStatsChannel(Object.keys(presets)[0]);
    }
  }, [presets]);

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


  const handleSaveScript = async () => {
    if (!selectedRun) return;
    setSavingScript(true);
    try {
      const res = await fetch(`/api/runs/${selectedRun.id}/update-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtube_title: editTitle,
          youtube_description: editDescription,
          full_narration: editNarration,
          variant: selectedVariant
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess('Script updated and video re-rendered successfully!');
        setSelectedRun(data.details);
      } else {
        showError(data.detail || 'Failed to update script');
      }
    } catch (err: any) {
      showError(err.message || 'An error occurred during save');
    } finally {
      setSavingScript(false);
    }
  };

  const handleRegenerateScene = async (sceneIdx: number) => {
    if (!selectedRun) return;
    setRegeneratingScene(true);
    try {
      const res = await fetch(`/api/runs/${selectedRun.id}/regenerate-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_index: sceneIdx,
          prompt: editPrompts[sceneIdx - 1],
          visual_mode: selectedRun.images.length > 0 ? 'image' : 'video'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Scene ${sceneIdx} regenerated and video re-compiled successfully!`);
        setSelectedRun(data.details);
      } else {
        showError(data.detail || 'Failed to regenerate scene visual');
      }
    } catch (err: any) {
      showError(err.message || 'An error occurred during regeneration');
    } finally {
      setRegeneratingScene(false);
    }
  };

  const handleVariantChange = (lang: string) => {
    setSelectedVariant(lang);
    if (selectedRun?.script?.variants?.[lang]) {
      const node = selectedRun.script.variants[lang];
      setEditTitle(node.youtube_title || '');
      setEditDescription(node.youtube_description || '');
      setEditNarration(node.full_narration || '');
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
          visual_mode: runVisualMode,
          language: runLanguage || null,
          gender: runGender || null
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
    const parsed = JSON.parse(JSON.stringify(presets[id]));
    const { category, emoji } = getPresetCategoryAndEmoji(parsed);
    setPresetForm({
      ...parsed,
      category,
      emoji
    });
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

  const deletePreset = async (id: string) => {
    if (!confirm(`Are you sure you want to delete preset '${id}'? This will permanently remove it from the configuration.`)) return;
    try {
      const res = await fetch(`/api/presets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showSuccess('Preset deleted successfully');
        fetchPresets();
        if (editingPresetId === id) {
          setPresetForm(null);
          setEditingPresetId('');
        }
      } else {
        showError('Failed to delete preset');
      }
    } catch (err) {
      showError('Error deleting preset');
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
    <div className="flex h-screen bg-[#07090e] text-slate-100 overflow-hidden font-sans">
      
      {/* Toast notifications */}
      {errorMsg && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-red-950/90 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl shadow-[0_0_20px_rgba(239,68,68,0.2)] backdrop-blur-md transition-all animate-bounce">
          <AlertCircle size={18} className="text-red-400" />
          <span className="font-mono text-xs">{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 px-4 py-3 rounded-xl shadow-[0_0_20px_rgba(5,255,197,0.2)] backdrop-blur-md transition-all animate-pulse">
          <CheckCircle size={18} className="text-neon-emerald" />
          <span className="font-mono text-xs">{successMsg}</span>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-64 glass-panel border-r border-white/5 flex flex-col justify-between p-5 m-3 rounded-2xl">
        <div className="flex flex-col gap-6">
          {/* Logo / Header */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="p-2 bg-neon-cyan/10 text-neon-cyan rounded-xl border border-neon-cyan/20 shadow-[0_0_15px_rgba(0,242,254,0.15)]">
              <Video className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white leading-none font-display">ShortsForge</h1>
              <p className="text-[10px] text-neon-emerald font-semibold uppercase tracking-widest mt-1.5 font-mono">AI Video Engine</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1.5">
            <button
              onClick={() => setActiveTab('home')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'home' 
                  ? 'bg-gradient-to-r from-neon-cyan/15 to-neon-emerald/5 text-neon-cyan border-l-2 border-neon-cyan shadow-[0_0_15px_rgba(0,242,254,0.08)]' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <FolderOpen size={18} />
              <span>Runs & History</span>
            </button>
            <button
              onClick={() => setActiveTab('niches')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'niches' 
                  ? 'bg-gradient-to-r from-neon-cyan/15 to-neon-emerald/5 text-neon-cyan border-l-2 border-neon-cyan shadow-[0_0_15px_rgba(0,242,254,0.08)]' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Sliders size={18} />
              <span>Channel Niches</span>
            </button>
            <button
              onClick={() => setActiveTab('runner')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative ${
                activeTab === 'runner' 
                  ? 'bg-gradient-to-r from-neon-cyan/15 to-neon-emerald/5 text-neon-cyan border-l-2 border-neon-cyan shadow-[0_0_15px_rgba(0,242,254,0.08)]' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Play size={18} />
              <span>Run Generator</span>
              {botRunning && (
                <span className="absolute right-3 top-3.5 w-2 h-2 rounded-full bg-neon-emerald animate-ping" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'config' 
                  ? 'bg-gradient-to-r from-neon-cyan/15 to-neon-emerald/5 text-neon-cyan border-l-2 border-neon-cyan shadow-[0_0_15px_rgba(0,242,254,0.08)]' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Key size={18} />
              <span>Secrets (.env)</span>
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'stats' 
                  ? 'bg-gradient-to-r from-neon-cyan/15 to-neon-emerald/5 text-neon-cyan border-l-2 border-neon-cyan shadow-[0_0_15px_rgba(0,242,254,0.08)]' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <BarChart2 size={18} />
              <span>Channel Stats</span>
            </button>
          </nav>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 p-3 bg-white/3 rounded-xl border border-white/5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-mono">Service Status</span>
            <span className={`flex items-center gap-1 font-semibold ${botRunning ? 'text-neon-emerald' : 'text-slate-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${botRunning ? 'bg-neon-emerald animate-pulse' : 'bg-slate-500'}`} />
              {botRunning ? 'Active' : 'Idle'}
            </span>
          </div>
          {botRunning && (
            <button 
              onClick={cancelBotRun}
              className="flex items-center justify-center gap-1.5 mt-2 py-1.5 bg-red-950/30 hover:bg-red-900 border border-red-500/20 text-red-200 text-xs font-medium rounded-lg transition-all"
            >
              <StopCircle size={14} />
              <span>Kill Subprocess</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
        
        {/* Top bar header */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-transparent">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-xs uppercase tracking-wider font-mono">Workspace</span>
            <ChevronRight size={12} className="text-slate-700" />
            <span className="text-white text-sm font-semibold capitalize font-display tracking-wide">{activeTab}</span>
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
              className="p-2 text-slate-400 hover:text-neon-cyan bg-white/3 border border-white/5 hover:border-neon-cyan/20 rounded-xl transition-all"
              title="Refresh Dashboard Data"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </header>

        {/* Content Container */}
        <div className="flex-1 overflow-y-auto p-8 animate-fade-in">
          
          {/* TAB 1: RUNS & HISTORY */}           {activeTab === 'home' && (
            <div className="flex flex-col gap-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-white font-display tracking-tight">Recent Generations</h2>
                  <p className="text-sm text-slate-400">View recent outputs, preview scripts, and watch rendered shorts.</p>
                </div>
              </div>

              {loadingRuns && runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <RefreshCw className="w-8 h-8 text-neon-cyan animate-spin" />
                  <span className="text-slate-400 text-sm font-mono">Loading historical runs...</span>
                </div>
              ) : runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 border border-dashed border-white/5 rounded-2xl bg-white/1">
                  <Video size={48} className="text-slate-600 mb-2" />
                  <span className="text-slate-400 text-sm font-medium">No outputs generated yet</span>
                  <p className="text-slate-500 text-xs mt-1">Start a run to generate your first YouTube Short!</p>
                  <button 
                    onClick={() => setActiveTab('runner')}
                    className="mt-4 px-4 py-2 bg-gradient-to-r from-neon-cyan to-neon-emerald text-slate-900 rounded-xl text-sm font-bold hover:opacity-90 transition-all shadow-[0_0_15px_rgba(0,242,254,0.15)]"
                  >
                    Go to Runner
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in stagger-2">
                  {runs.map((run) => (
                    <div 
                      key={run.id}
                      className="relative overflow-hidden rounded-2xl border border-white/5 bg-slate-950/40 backdrop-blur-md group hover:border-neon-cyan/25 transition-all duration-500 shadow-lg hover:shadow-[0_0_30px_rgba(0,242,254,0.06)] h-56 flex flex-col justify-between"
                    >
                      {/* Visual Preview Background */}
                      {run.has_images && run.first_image ? (
                        <>
                          <img 
                            src={`/api/runs/${run.id}/files/images/${run.first_image}`} 
                            alt="Background preview"
                            className="absolute inset-0 w-full h-full object-cover opacity-10 group-hover:opacity-20 group-hover:scale-105 transition-all duration-700 pointer-events-none filter blur-[1px]"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-[#05060b] via-[#05060b]/75 to-[#05060b]/30 pointer-events-none" />
                        </>
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900/60 to-slate-950 pointer-events-none opacity-50" />
                      )}

                      <div className="p-5 flex flex-col justify-between h-full z-10 relative">
                        <div>
                          {/* Channel & Time info header */}
                          <div className="flex items-center justify-between mb-3.5">
                            <span className="px-2.5 py-1 bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 rounded-full text-[9px] font-bold uppercase tracking-wider font-mono shadow-[0_0_10px_rgba(0,242,254,0.05)]">
                              🏷️ {run.channel.replace('_', ' ')}
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px] text-slate-555 font-mono">
                              <Clock size={11} className="text-slate-600" />
                              {formatTimestamp(run.timestamp)}
                            </span>
                          </div>

                          {/* Run ID / Directory Name */}
                          <h3 className="text-xs font-bold text-slate-350 line-clamp-2 leading-relaxed font-mono group-hover:text-white transition-colors">
                            {run.id}
                          </h3>
                        </div>

                        {/* Card bottom section */}
                        <div className="flex items-center justify-between pt-3.5 border-t border-white/5">
                          {/* File status indicators with glows */}
                          <div className="flex gap-2 font-mono">
                            <span 
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border uppercase tracking-wider ${
                                run.has_video 
                                  ? 'bg-neon-emerald/10 border-neon-emerald/30 text-neon-emerald shadow-[0_0_10px_rgba(5,255,197,0.05)]' 
                                  : 'bg-white/1 border-white/5 text-slate-600'
                              }`}
                            >
                              MP4
                            </span>
                            <span 
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border uppercase tracking-wider ${
                                run.has_script 
                                  ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan shadow-[0_0_10px_rgba(0,242,254,0.05)]' 
                                  : 'bg-white/1 border-white/5 text-slate-600'
                              }`}
                            >
                              Script
                            </span>
                            <span 
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border uppercase tracking-wider ${
                                run.has_images 
                                  ? 'bg-neon-pink/10 border-neon-pink/30 text-neon-pink shadow-[0_0_10px_rgba(255,0,127,0.05)]' 
                                  : 'bg-white/1 border-white/5 text-slate-600'
                              }`}
                            >
                              PNGs
                            </span>
                          </div>

                          {/* Inspect trigger button */}
                          <button
                            onClick={() => loadRunDetail(run)}
                            disabled={loadingRunId === run.id}
                            className="flex items-center gap-1 py-1.5 px-3 bg-white/3 hover:bg-neon-cyan/10 border border-white/5 hover:border-neon-cyan/20 text-xs font-bold text-slate-350 hover:text-neon-cyan rounded-xl transition-all cursor-pointer font-mono group/btn"
                          >
                            {loadingRunId === run.id ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <>
                                <span>Inspect</span>
                                <ChevronRight size={12} className="group-hover/btn:translate-x-0.5 transition-transform" />
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
              <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex justify-between items-center pb-3 border-b border-white/5">
                  <h3 className="font-bold text-white text-base font-display">Channel Presets</h3>
                  <button 
                    onClick={createNewPreset}
                    className="flex items-center gap-1 py-1 px-2.5 bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 text-xs font-bold rounded-lg hover:bg-neon-cyan/20 transition-all font-mono cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>Create</span>
                  </button>
                </div>

                {/* Category Pill Filters */}
                <div className="flex gap-1.5 overflow-x-auto pb-2 border-b border-white/5 scrollbar-none">
                  {[
                    { id: 'all', label: 'All', icon: '✨' },
                    { id: 'lore', label: 'Lore', icon: '🌌' },
                    { id: 'facts', label: 'Facts', icon: '💡' },
                    { id: 'horror', label: 'Horror', icon: '👻' },
                    { id: 'history', label: 'History', icon: '📜' },
                    { id: 'tech', label: 'Tech', icon: '⚡' },
                    { id: 'other', label: 'Other', icon: '🤖' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedNicheCategory(cat.id)}
                      className={`flex items-center gap-1 py-1 px-2.5 rounded-lg border text-[10px] font-bold uppercase transition-all duration-200 cursor-pointer ${
                        selectedNicheCategory === cat.id
                          ? 'bg-neon-cyan/15 border-neon-cyan/40 text-neon-cyan shadow-[0_0_10px_rgba(0,242,254,0.1)] font-bold'
                          : 'bg-[#0e111a]/30 border-white/5 text-slate-450 hover:text-slate-200 hover:border-white/10'
                      }`}
                    >
                      <span>{cat.icon}</span>
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>

                {/* Sidebar presets scrollable container */}
                <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
                  {Object.keys(presets)
                    .filter((id) => {
                      if (selectedNicheCategory === 'all') return true;
                      const { category } = getPresetCategoryAndEmoji(presets[id]);
                      return category === selectedNicheCategory;
                    })
                    .map((id) => {
                      const preset = presets[id];
                      const isEditing = editingPresetId === id;
                      const { category, emoji } = getPresetCategoryAndEmoji(preset);
                      
                      return (
                        <div 
                          key={id}
                          className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all duration-300 group ${
                            isEditing 
                              ? 'bg-neon-cyan/5 border-neon-cyan/35 text-neon-cyan shadow-[0_0_15px_rgba(0,242,254,0.05)]' 
                              : 'bg-[#0d1017]/45 border-white/5 text-slate-450 hover:text-slate-200 hover:border-white/10 hover:translate-x-0.5'
                          }`}
                        >
                          <span className="text-lg bg-[#05060b] p-2 rounded-xl border border-white/5 flex items-center justify-center w-10 h-10">{emoji}</span>
                          <button 
                            onClick={() => startEditingPreset(id)}
                            className="flex-1 text-left cursor-pointer"
                          >
                            <span className="font-bold block text-sm tracking-tight text-white">{preset.label || id}</span>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[9px] font-mono text-slate-500 uppercase">{category}</span>
                              <span className="text-[9px] font-mono text-slate-650">•</span>
                              <span className="text-[9px] font-mono text-slate-500">{preset.segment_count || 5} beats</span>
                            </div>
                          </button>
                          
                          <button 
                            onClick={() => deletePreset(id)}
                            className="opacity-0 group-hover:opacity-100 p-2 text-slate-500 hover:text-red-400 hover:bg-red-950/20 rounded-xl transition-all ml-2 cursor-pointer"
                            title="Delete Preset"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                      );
                    })}
                  {Object.keys(presets).filter((id) => {
                    if (selectedNicheCategory === 'all') return true;
                    const { category } = getPresetCategoryAndEmoji(presets[id]);
                    return category === selectedNicheCategory;
                  }).length === 0 && (
                    <div className="text-slate-600 text-xs italic text-center py-10 font-mono">No presets found in this category.</div>
                  )}
                </div>
              </div>

              {/* Preset Editor Pane */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                {presetForm ? (
                  <div className="glass-panel rounded-2xl p-6 flex flex-col gap-5">
                    {/* Editor Header */}
                    <div className="flex justify-between items-center border-b border-white/5 pb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl bg-[#05060b] p-2.5 rounded-xl border border-white/5 flex items-center justify-center w-14 h-14 shadow-inner">{presetForm.emoji || '✨'}</span>
                        <div>
                          <h3 className="font-bold text-lg text-white font-display">Preset Editor</h3>
                          <p className="text-xs text-slate-500 mt-1">Preset ID: <code className="text-neon-cyan bg-neon-cyan/5 border border-neon-cyan/10 py-0.5 px-1.5 rounded-md font-mono">{presetForm.id}</code></p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setPresetForm(null)}
                          className="px-4 py-2 bg-white/3 hover:bg-white/5 border border-white/5 text-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={savePreset}
                          className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-neon-cyan to-neon-emerald text-slate-900 text-xs font-bold rounded-xl hover:opacity-90 transition-all shadow-[0_0_15px_rgba(0,242,254,0.15)] cursor-pointer"
                        >
                          <Save size={14} />
                          <span>Save Preset</span>
                        </button>
                      </div>
                    </div>

                    {/* Sub-tabs Navigation */}
                    <div className="flex border-b border-white/5 pb-2 gap-4">
                      {[
                        { id: 'core', label: 'Core Settings' },
                        { id: 'ai', label: 'AI Directives' },
                        { id: 'media', label: 'Speech & Captions' },
                        { id: 'topics', label: 'Topic Pool' },
                      ].map((subTab) => (
                        <button
                          key={subTab.id}
                          onClick={() => setEditorSubTab(subTab.id as any)}
                          className={`pb-2 px-1 text-xs font-bold uppercase font-mono relative transition-all duration-300 cursor-pointer ${
                            editorSubTab === subTab.id
                              ? 'text-neon-cyan font-bold'
                              : 'text-slate-500 hover:text-slate-350'
                          }`}
                        >
                          {subTab.label}
                          {editorSubTab === subTab.id && (
                            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-neon-cyan shadow-[0_0_8px_rgba(0,242,254,0.8)]" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Sub-tab content blocks */}
                    <div className="min-h-[320px]">
                      
                      {/* Sub-tab 1: Core Settings */}
                      {editorSubTab === 'core' && (
                        <div className="flex flex-col gap-5 animate-fade-in stagger-1">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Channel Name/Label</label>
                              <input 
                                type="text" 
                                value={presetForm.label}
                                onChange={(e) => setPresetForm({ ...presetForm, label: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Default Visual Mode</label>
                              <select
                                value={presetForm.visual_mode || 'image'}
                                onChange={(e) => setPresetForm({ ...presetForm, visual_mode: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                              >
                                <option value="image">Still Images (Flux Klein)</option>
                                <option value="video">LTX-2.3 Video Clips</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 font-mono">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Segment Count (Beats)</label>
                              <input 
                                type="number" 
                                value={presetForm.segment_count}
                                onChange={(e) => setPresetForm({ ...presetForm, segment_count: parseInt(e.target.value) || 5 })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Min Narration Words</label>
                              <input 
                                type="number" 
                                value={presetForm.min_words || 0}
                                onChange={(e) => setPresetForm({ ...presetForm, min_words: parseInt(e.target.value) || 0 })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Niche Category</label>
                              <select
                                value={presetForm.category || 'other'}
                                onChange={(e) => setPresetForm({ ...presetForm, category: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                              >
                                <option value="lore">Lore & Mythology</option>
                                <option value="facts">Curiosity & Facts</option>
                                <option value="horror">Horror & Spooky</option>
                                <option value="history">History & Past</option>
                                <option value="tech">Tech & Future</option>
                                <option value="other">General / Other</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Topic Rotation Key</label>
                              <input 
                                type="text" 
                                value={presetForm.topic_rotation || ''}
                                onChange={(e) => setPresetForm({ ...presetForm, topic_rotation: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                                placeholder="e.g. myth"
                              />
                            </div>
                          </div>

                          {/* Custom Emoji Picker Grid */}
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2 font-mono">Custom Preset Icon Picker</label>
                            <div className="flex flex-wrap gap-2.5 p-3 bg-[#0d1017]/60 border border-white/5 rounded-2xl max-h-40 overflow-y-auto">
                              {PRESET_EMOJIS.map((emojiOption) => (
                                <button
                                  key={emojiOption}
                                  type="button"
                                  onClick={() => setPresetForm({ ...presetForm, emoji: emojiOption })}
                                  className={`w-10 h-10 flex items-center justify-center text-lg rounded-xl border transition-all cursor-pointer hover:scale-105 ${
                                    presetForm.emoji === emojiOption
                                      ? 'bg-neon-cyan/20 border-neon-cyan text-white scale-110 shadow-[0_0_12px_rgba(0,242,254,0.25)] font-bold'
                                      : 'bg-white/3 border-white/5 text-slate-400 hover:bg-white/5 hover:border-white/10'
                                  }`}
                                >
                                  {emojiOption}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sub-tab 2: AI Directives */}
                      {editorSubTab === 'ai' && (
                        <div className="flex flex-col gap-4 animate-fade-in stagger-1">
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5 font-mono">Groq/Gemini System Prompt / Niche Directives</label>
                            <textarea 
                              rows={5}
                              value={presetForm.groq_system_hint}
                              onChange={(e) => setPresetForm({ ...presetForm, groq_system_hint: e.target.value })}
                              className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 leading-relaxed text-slate-200"
                              placeholder="Describe the directives for script generation..."
                            />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5 font-mono">Image Style Suffix</label>
                              <textarea 
                                rows={3}
                                value={presetForm.image_style_suffix || ''}
                                onChange={(e) => setPresetForm({ ...presetForm, image_style_suffix: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200 leading-normal"
                                placeholder="Appended to prompt (e.g. hyperrealistic cinematic shot, 8k, photorealistic...)"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5 font-mono">Negative Prompt</label>
                              <textarea 
                                rows={3}
                                value={presetForm.image_negative_prompt || ''}
                                onChange={(e) => setPresetForm({ ...presetForm, image_negative_prompt: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200 leading-normal"
                                placeholder="Elements to exclude..."
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sub-tab 3: Speech & Captions */}
                      {editorSubTab === 'media' && (
                        <div className="flex flex-col gap-4 animate-fade-in stagger-1">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5 font-mono">TTS Voice (Edge TTS)</label>
                              <input 
                                type="text" 
                                value={presetForm.tts_voice || ''}
                                onChange={(e) => setPresetForm({ ...presetForm, tts_voice: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                                placeholder="e.g. en-US-ChristopherNeural"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5 font-mono">YouTube refresh token env</label>
                              <input 
                                type="text" 
                                value={presetForm.yt_token_env || ''}
                                onChange={(e) => setConfigForm({ ...presetForm, yt_token_env: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                                placeholder="e.g. YT_REFRESH_TOKEN_MYTH"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5 font-mono">Caption Font File</label>
                              <input 
                                type="text" 
                                value={presetForm.caption_font || ''}
                                onChange={(e) => setPresetForm({ ...presetForm, caption_font: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                                placeholder="e.g. BebasNeue-Regular.ttf"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5 font-mono">Caption Font Name</label>
                              <input 
                                type="text" 
                                value={presetForm.caption_font_name || ''}
                                onChange={(e) => setPresetForm({ ...presetForm, caption_font_name: e.target.value })}
                                className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                                placeholder="e.g. Bebas Neue"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sub-tab 4: Topic Pool */}
                      {editorSubTab === 'topics' && (
                        <div className="flex flex-col gap-4 animate-fade-in stagger-1">
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5 font-mono">Topic Rotation Pool</label>
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
                                className="flex-1 bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
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
                                className="py-2 px-4 bg-white/5 hover:bg-white/10 border border-white/5 text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
                              >
                                Add
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2 max-h-[220px] overflow-y-auto p-3.5 bg-[#0d1017]/60 border border-white/5 rounded-2xl">
                              {(presetForm.topic_pool || []).map((topic, i) => (
                                <span 
                                  key={i} 
                                  className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 bg-white/3 border border-white/5 text-slate-350 rounded-lg text-xs font-medium hover:border-red-500/20 hover:bg-red-950/10 group transition-all"
                                >
                                  <span>{topic}</span>
                                  <button
                                    onClick={() => {
                                      const topics = [...presetForm.topic_pool];
                                      topics.splice(i, 1);
                                      setPresetForm({ ...presetForm, topic_pool: topics });
                                    }}
                                    className="p-0.5 text-slate-500 hover:text-red-400 hover:bg-red-950/20 rounded transition-all cursor-pointer"
                                  >
                                    <X size={10} />
                                  </button>
                                </span>
                              ))}
                              {(presetForm.topic_pool || []).length === 0 && (
                                <span className="text-xs text-slate-550 italic p-1">No topics in pool. The generator will require manually entered topics.</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                    </div>

                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full min-h-[380px] border border-dashed border-white/5 rounded-2xl bg-white/1 p-6 text-center">
                    <Sliders size={40} className="text-slate-650 mb-3" />
                    <span className="text-slate-400 text-sm font-semibold">No Preset Selected</span>
                    <p className="text-slate-500 text-xs mt-1.5 max-w-xs">Select a preset on the sidebar or click Create to customize a channel's settings.</p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: TRIGGER BOT (RUNNER) */}
          {activeTab === 'runner' && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              
              {/* Trigger Options */}
              <div className="flex flex-col gap-6 animate-fade-in stagger-1">
                <div className="glass-panel rounded-2xl p-5 flex flex-col gap-5">
                  <h3 className="font-bold text-white text-base border-b border-white/5 pb-3 font-display">Bot Execution Controls</h3>
                  
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2 font-mono">Target Channel Niche</label>
                    <select
                      value={runChannel}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRunChannel(val);
                        if (presets[val]) {
                          setRunVisualMode((presets[val].visual_mode || 'image') as 'image' | 'video');
                        }
                      }}
                      disabled={botRunning}
                      className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200 capitalize"
                    >
                      {Object.keys(presets).map((id) => (
                        <option key={id} value={id}>{presets[id].label || id}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2 font-mono">Topic Hint (Optional Override)</label>
                    <input 
                      type="text"
                      placeholder="e.g. Bermuda Triangle mysteries"
                      value={runTopic}
                      onChange={(e) => setRunTopic(e.target.value)}
                      disabled={botRunning}
                      className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">If blank, picks a random topic from the channel's pool.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2 font-mono">Language Selection</label>
                      <select
                        value={runLanguage}
                        onChange={(e) => setRunLanguage(e.target.value)}
                        disabled={botRunning}
                        className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                      >
                        <option value="">Preset Default</option>
                        <option value="en">English</option>
                        <option value="hi">Hindi</option>
                        <option value="te">Telugu</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2 font-mono">Voice Gender</label>
                      <select
                        value={runGender}
                        onChange={(e) => setRunGender(e.target.value)}
                        disabled={botRunning}
                        className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200"
                      >
                        <option value="">Preset Default</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2 font-mono">Visual Generation Mode</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRunVisualMode('image')}
                        disabled={botRunning}
                        className={`py-2 px-3 text-xs font-bold uppercase rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
                          runVisualMode === 'image'
                            ? 'bg-neon-cyan/15 border-neon-cyan text-neon-cyan font-bold shadow-[0_0_15px_rgba(0,242,254,0.15)]'
                            : 'bg-white/3 border-white/5 text-slate-400 hover:border-white/10 font-semibold'
                        }`}
                      >
                        <span>🖼️ Still Images</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRunVisualMode('video')}
                        disabled={botRunning}
                        className={`py-2 px-3 text-xs font-bold uppercase rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
                          runVisualMode === 'video'
                            ? 'bg-neon-cyan/15 border-neon-cyan text-neon-cyan font-bold shadow-[0_0_15px_rgba(0,242,254,0.15)]'
                            : 'bg-white/3 border-white/5 text-slate-400 hover:border-white/10 font-semibold'
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

                  <div className="flex items-center gap-3 py-1.5 bg-white/3 px-3 rounded-xl border border-white/5">
                    <input 
                      type="checkbox"
                      id="upload_cb"
                      checked={runUpload}
                      onChange={(e) => setRunUpload(e.target.checked)}
                      disabled={botRunning}
                      className="rounded border-white/10 text-neon-cyan focus:ring-neon-cyan h-4 w-4 bg-white/3"
                    />
                    <label htmlFor="upload_cb" className="text-xs text-slate-350 font-semibold cursor-pointer">Upload directly to YouTube</label>
                  </div>

                  {runUpload && (
                    <div className="border border-white/5 bg-white/1 rounded-xl p-3.5 flex flex-col gap-2.5">
                      <label className="block text-[10px] font-bold uppercase text-slate-500 font-mono">YouTube Upload Visibility</label>
                      <div className="flex gap-4">
                        {['private', 'unlisted', 'public'].map((privacy) => (
                          <label key={privacy} className="flex items-center gap-1.5 text-xs text-slate-350 cursor-pointer">
                            <input 
                              type="radio" 
                              name="privacy" 
                              value={privacy}
                              checked={runPrivacy === privacy}
                              onChange={() => setRunPrivacy(privacy as any)}
                              className="text-neon-cyan focus:ring-neon-cyan h-3 w-3 bg-white/3"
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
                        className="w-full flex items-center justify-center gap-2 py-3 bg-red-950/45 hover:bg-red-900 border border-red-500/20 text-red-200 font-bold rounded-xl transition-all"
                      >
                        <StopCircle size={18} />
                        <span>Kill Bot Generation</span>
                      </button>
                    ) : (
                      <button
                        onClick={triggerBotRun}
                        disabled={!runChannel}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-neon-cyan to-neon-emerald hover:opacity-90 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(0,242,254,0.2)]"
                      >
                        <Play size={18} />
                        <span>Run Generation Bot</span>
                      </button>
                    )}
                  </div>
                            <div className="glass-panel rounded-2xl p-4 flex gap-3.5 items-start">
                  <Terminal size={20} className="text-neon-cyan mt-0.5 animate-pulse" />
                  <div>
                    <h4 className="text-xs font-bold text-slate-350 uppercase">Ffmpeg Burn-In Note</h4>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">Ensure FFmpeg is installed and configured on your path (`brew install ffmpeg` / `sudo apt install ffmpeg`). Burn-in subtitles draw from presets font settings.</p>
                  </div>
                </div>
              </div>
            </div>

              {/* Console Logger */}
              <div className="xl:col-span-2 flex flex-col min-h-[500px]">
                <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden shadow-2xl">
                  {/* Console Header */}
                  <div className="bg-white/3 border-b border-white/5 px-5 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                      </div>
                      <span className="text-xs font-bold text-slate-400 font-mono tracking-tight ml-2">Console Logs (run_short.log)</span>
                    </div>

                    <button 
                      onClick={() => setBotLogs([])}
                      className="text-[10px] text-slate-400 hover:text-white font-semibold px-2 py-1 bg-white/5 border border-white/5 rounded-lg transition-all"
                    >
                      Clear Logs
                    </button>
                  </div>

                  {/* Real-time Progress Stepper */}
                  {/* Real-time Progress Stepper */}
                  {(() => {
                    const progress = botRunning || botLogs.length > 0 
                      ? getBotProgress(botLogs) 
                      : { activeStep: 0, detailText: 'Pipeline idle. Ready to forge.', subprogress: 0 };
                    
                    const steps = [
                      { id: 1, name: 'Script', emoji: '📜', desc: 'Script Gen' },
                      { id: 2, name: 'Visuals', emoji: runVisualMode === 'video' ? '🎥' : '🖼️', desc: 'Assets' },
                      { id: 3, name: 'Voice', emoji: '🎙️', desc: 'TTS Voice' },
                      { id: 4, name: 'Render', emoji: '🎬', desc: 'FFmpeg Mix' },
                      { id: 5, name: 'Upload', emoji: '📤', desc: 'Upload' },
                      { id: 6, name: 'Done', emoji: '🎉', desc: 'Finished' }
                    ];

                    return (
                      <div className="bg-white/1 border-b border-white/5 p-6 flex flex-col gap-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${botRunning ? 'bg-neon-cyan animate-pulse shadow-[0_0_8px_#00f2fe]' : 'bg-slate-650'}`} />
                            <span className="text-[10px] text-slate-450 uppercase font-bold tracking-wider font-mono">ShortsForge Pipeline</span>
                          </div>
                          <span className="text-xs text-neon-cyan font-bold font-mono">{progress.detailText}</span>
                        </div>
                        
                        {/* Stepper Steps */}
                        <div className="flex items-center justify-between relative mt-4 px-2">
                          {/* Connection line */}
                          <div className="absolute left-6 right-6 top-6 h-0.5 bg-white/5 -translate-y-1/2 z-0" />
                          <div 
                            className="absolute left-6 top-6 h-0.5 bg-gradient-to-r from-neon-cyan to-neon-emerald -translate-y-1/2 z-0 transition-all duration-500 shadow-[0_0_10px_rgba(0,242,254,0.4)]" 
                            style={{ 
                              width: `${progress.activeStep > 0 ? ((Math.min(progress.activeStep, 6) - 1) / 5) * 100 : 0}%` 
                            }} 
                          />

                          {steps.map((step) => {
                            const isCompleted = progress.activeStep > step.id || (progress.activeStep === 6 && step.id === 6);
                            const isActive = progress.activeStep === step.id;

                            return (
                              <div key={step.id} className="flex flex-col items-center z-10 relative flex-1">
                                <div 
                                  className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center border transition-all duration-500 relative ${
                                    isCompleted 
                                      ? 'bg-neon-emerald/10 border-neon-emerald text-white shadow-[0_0_15px_rgba(5,255,197,0.15)] font-bold' 
                                      : isActive 
                                      ? 'bg-neon-cyan/15 border-neon-cyan text-white scale-110 shadow-[0_0_20px_rgba(0,242,254,0.3)] ring-4 ring-neon-cyan/10 font-bold' 
                                      : 'bg-[#07090e] border-white/5 text-slate-550'
                                  }`}
                                >
                                  {/* Subprogress overlay for active step 2 (visuals) */}
                                  {isActive && step.id === 2 && progress.subprogress > 0 && (
                                    <div 
                                      className="absolute inset-0 bg-neon-cyan/10 rounded-2xl transition-all duration-300"
                                      style={{ height: `${progress.subprogress}%`, top: 'auto' }}
                                    />
                                  )}

                                  {isCompleted ? (
                                    <span className="text-base text-neon-emerald font-bold">✓</span>
                                  ) : isActive && step.id === 2 && progress.subprogress > 0 ? (
                                    <span className="text-[10px] font-mono text-neon-cyan font-bold">{progress.subprogress}%</span>
                                  ) : (
                                    <span className="text-base">{step.emoji}</span>
                                  )}
                                </div>
                                <span 
                                  className={`text-[9px] mt-2 font-bold tracking-wider uppercase font-mono transition-all duration-300 ${
                                    isCompleted ? 'text-neon-emerald' : isActive ? 'text-neon-cyan' : 'text-slate-500'
                                  }`}
                                >
                                  {step.name}
                                </span>
                                <span className="text-[7px] font-mono text-slate-600 mt-0.5">{step.desc}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Log Body */}
                  <div className="flex-1 overflow-y-auto p-5 font-mono text-xs text-slate-350 bg-slate-950/40 leading-relaxed flex flex-col gap-1.5 max-h-[600px]">
                    {botLogs.map((log, i) => (
                      <div 
                        key={i} 
                        className={`${
                          log.includes('⚠') ? 'text-amber-300 font-medium font-mono' : 
                          log.includes('ERROR') || log.includes('failed') ? 'text-red-400 font-semibold font-mono' : 
                          log.includes('✓') || log.includes('Done') || log.includes('Uploaded') ? 'text-neon-emerald font-semibold font-mono' : 
                          log.includes('━━━') ? 'text-neon-cyan font-bold border-y border-white/5 py-1.5 my-1 font-mono' :
                          'text-slate-400 font-mono text-[11px]'
                        }`}
                      >
                        {log}
                      </div>
                    ))}
                    {botLogs.length === 0 && (
                      <div className="text-slate-650 italic text-center py-20 font-mono text-xs">Console idle. Logs will stream here during a generation run.</div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 4: API SECRETS CONFIG */}
          {activeTab === 'config' && (
            <div className="max-w-3xl flex flex-col gap-6 animate-fade-in stagger-1">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <div>
                  <h2 className="text-2xl font-bold text-white font-display tracking-tight">Environment Configuration</h2>
                  <p className="text-sm text-slate-450 mt-1">Safely configure API tokens and OAuth variables in your project's `.env` file.</p>
                </div>

                <button 
                  onClick={saveConfig}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-neon-cyan to-neon-emerald text-slate-900 font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(0,242,254,0.15)] hover:opacity-90 cursor-pointer"
                >
                  <Save size={16} />
                  <span>Save configuration</span>
                </button>
              </div>

              {loadingConfig && Object.keys(configForm).length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <RefreshCw className="w-8 h-8 text-neon-cyan animate-spin" />
                  <span className="text-slate-500 text-sm font-mono">Loading config...</span>
                </div>
              ) : (
                <div className="glass-panel rounded-2xl p-6 flex flex-col gap-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-5 border-b border-white/5">
                    <div>
                      <h4 className="text-xs font-bold text-neon-cyan uppercase tracking-wider mb-4 font-mono">LLM Provider & Credentials</h4>
                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">LLM_PROVIDER</label>
                          <select 
                            value={configForm['LLM_PROVIDER'] || 'groq'}
                            onChange={(e) => setConfigForm({ ...configForm, LLM_PROVIDER: e.target.value })}
                            className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                          >
                            <option value="groq">Groq (Default)</option>
                            <option value="gemini">Gemini (Google 2.5 Flash)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">GROQ_API_KEY</label>
                          <div className="flex relative">
                            <input 
                              type={showTokens['GROQ_API_KEY'] ? 'text' : 'password'}
                              value={configForm['GROQ_API_KEY'] || ''}
                              onChange={(e) => setConfigForm({ ...configForm, GROQ_API_KEY: e.target.value })}
                              className="w-full bg-white/3 border border-white/5 rounded-xl py-2 pl-3 pr-10 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                            />
                            <button
                              onClick={() => toggleTokenVisibility('GROQ_API_KEY')}
                              className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-350"
                            >
                              {showTokens['GROQ_API_KEY'] ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">GEMINI_API_KEY</label>
                          <div className="flex relative">
                            <input 
                              type={showTokens['GEMINI_API_KEY'] ? 'text' : 'password'}
                              value={configForm['GEMINI_API_KEY'] || ''}
                              onChange={(e) => setConfigForm({ ...configForm, GEMINI_API_KEY: e.target.value })}
                              className="w-full bg-white/3 border border-white/5 rounded-xl py-2 pl-3 pr-10 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                            />
                            <button
                              onClick={() => toggleTokenVisibility('GEMINI_API_KEY')}
                              className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-350"
                            >
                              {showTokens['GEMINI_API_KEY'] ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">GEMINI_MODEL</label>
                          <input 
                            type="text"
                            value={configForm['GEMINI_MODEL'] || 'gemini-2.5-flash'}
                            onChange={(e) => setConfigForm({ ...configForm, GEMINI_MODEL: e.target.value })}
                            className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">GROQ_MODEL</label>
                          <input 
                            type="text"
                            value={configForm['GROQ_MODEL'] || 'llama-3.3-70b-versatile'}
                            onChange={(e) => setConfigForm({ ...configForm, GROQ_MODEL: e.target.value })}
                            className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-neon-cyan uppercase tracking-wider mb-4 font-mono">DeAPI.ai (Visuals)</h4>
                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">DEAPI_TOKEN</label>
                          <div className="flex relative">
                            <input 
                              type={showTokens['DEAPI_TOKEN'] ? 'text' : 'password'}
                              value={configForm['DEAPI_TOKEN'] || ''}
                              onChange={(e) => setConfigForm({ ...configForm, DEAPI_TOKEN: e.target.value })}
                              className="w-full bg-white/3 border border-white/5 rounded-xl py-2 pl-3 pr-10 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                            />
                            <button
                              onClick={() => toggleTokenVisibility('DEAPI_TOKEN')}
                              className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-350"
                            >
                              {showTokens['DEAPI_TOKEN'] ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">DEAPI_MODEL</label>
                          <input 
                            type="text"
                            value={configForm['DEAPI_MODEL'] || 'Flux_2_Klein_4B_BF16'}
                            onChange={(e) => setConfigForm({ ...configForm, DEAPI_MODEL: e.target.value })}
                            className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                          />
                        </div>
                    </div>
                  </div>
                </div>

                  <div className="flex flex-col gap-4">
                    <h4 className="text-xs font-bold text-neon-cyan uppercase tracking-wider font-mono">YouTube OAuth Credentials</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">YT_CLIENT_SECRET</label>
                        <input 
                          type="text"
                          value={configForm['YT_CLIENT_SECRET'] || 'secrets/client_secret.json'}
                          onChange={(e) => setConfigForm({ ...configForm, YT_CLIENT_SECRET: e.target.value })}
                          className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">YT_TOKEN</label>
                        <input 
                          type="text"
                          value={configForm['YT_TOKEN'] || 'secrets/youtube_token.json'}
                          onChange={(e) => setConfigForm({ ...configForm, YT_TOKEN: e.target.value })}
                          className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-550 mb-1.5 font-mono uppercase font-bold">YT_REFRESH_TOKEN</label>
                      <div className="flex relative">
                        <input 
                          type={showTokens['YT_REFRESH_TOKEN'] ? 'text' : 'password'}
                          value={configForm['YT_REFRESH_TOKEN'] || ''}
                          onChange={(e) => setConfigForm({ ...configForm, YT_REFRESH_TOKEN: e.target.value })}
                          className="w-full bg-white/3 border border-white/5 rounded-xl py-2 pl-3 pr-10 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                        />
                        <button
                          onClick={() => toggleTokenVisibility('YT_REFRESH_TOKEN')}
                          className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-350"
                        >
                          {showTokens['YT_REFRESH_TOKEN'] ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="max-w-6xl flex flex-col gap-6 animate-fade-in stagger-1">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <div>
                  <h2 className="text-2xl font-bold text-white font-display tracking-tight">Channel Analytics Dashboard</h2>
                  <p className="text-sm text-slate-400 mt-1">Track views, subscriber counts, and estimated revenue metrics for your automated Shorts channels.</p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 font-mono uppercase font-bold">Select Channel</span>
                  <select
                    value={statsChannel}
                    onChange={(e) => setStatsChannel(e.target.value)}
                    className="bg-[#0b0f19] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-205 focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-white"
                  >
                    {Object.keys(presets).map((key) => (
                      <option key={key} value={key}>
                        {presets[key].label}
                      </option>
                    ))}
                  </select>
                  
                  <button
                    onClick={() => fetchStats(statsChannel)}
                    className="p-2 text-slate-400 hover:text-white bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all cursor-pointer"
                  >
                    <RefreshCw size={15} className={statsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {statsLoading && !channelStats ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <RefreshCw className="w-8 h-8 text-neon-cyan animate-spin" />
                  <span className="text-slate-500 text-sm font-mono animate-pulse">Loading channel analytics...</span>
                </div>
              ) : channelStats ? (
                <div className="flex flex-col gap-6">
                  {/* Top Stats Cards Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="glass-panel rounded-2xl p-5 relative overflow-hidden group shadow-[0_0_15px_rgba(0,0,0,0.2)] border border-white/5">
                      <div className="absolute right-3 top-3 p-1.5 bg-neon-cyan/10 rounded-lg text-neon-cyan group-hover:scale-110 transition-all duration-300">
                        <FolderOpen size={16} />
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono uppercase font-bold">Channel Title</span>
                      <h3 className="text-lg font-bold text-white mt-1.5 font-display truncate pr-8">{channelStats.channel_title}</h3>
                      {channelStats.is_mock && (
                        <span className="inline-block mt-2 text-[8px] bg-white/5 text-slate-400 font-bold px-1.5 py-0.5 rounded border border-white/5 font-mono uppercase">Simulation Profile</span>
                      )}
                    </div>

                    <div className="glass-panel rounded-2xl p-5 relative overflow-hidden group shadow-[0_0_15px_rgba(0,0,0,0.2)] border border-white/5">
                      <div className="absolute right-3 top-3 p-1.5 bg-neon-cyan/10 rounded-lg text-neon-cyan group-hover:scale-110 transition-all duration-300">
                        <BarChart2 size={16} />
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono uppercase font-bold">Subscribers</span>
                      <h3 className="text-2xl font-bold text-neon-cyan mt-1.5 font-display">
                        {channelStats.subscribers?.toLocaleString()}
                      </h3>
                      <p className="text-[10px] text-neon-emerald font-semibold mt-1 flex items-center gap-0.5">
                        <span>+{(channelStats.historical_data?.[channelStats.historical_data.length - 1]?.subscribers_gain || 0).toLocaleString()} today</span>
                      </p>
                    </div>

                    <div className="glass-panel rounded-2xl p-5 relative overflow-hidden group shadow-[0_0_15px_rgba(0,0,0,0.2)] border border-white/5">
                      <div className="absolute right-3 top-3 p-1.5 bg-neon-cyan/10 rounded-lg text-neon-cyan group-hover:scale-110 transition-all duration-300">
                        <Eye size={16} />
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono uppercase font-bold">Total Views</span>
                      <h3 className="text-2xl font-bold text-white mt-1.5 font-display">
                        {channelStats.views?.toLocaleString()}
                      </h3>
                      <p className="text-[10px] text-neon-emerald font-semibold mt-1 flex items-center gap-0.5">
                        <span>+{(channelStats.historical_data?.[channelStats.historical_data.length - 1]?.views_gain || 0).toLocaleString()} today</span>
                      </p>
                    </div>

                    <div className="glass-panel rounded-2xl p-5 relative overflow-hidden group shadow-[0_0_15px_rgba(0,0,0,0.2)] border border-white/5">
                      <div className="absolute right-3 top-3 p-1.5 bg-neon-cyan/10 rounded-lg text-neon-cyan group-hover:scale-110 transition-all duration-300">
                        <Video size={16} />
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono uppercase font-bold">Videos Uploaded</span>
                      <h3 className="text-2xl font-bold text-white mt-1.5 font-display">
                        {channelStats.videos}
                      </h3>
                      <p className="text-[10px] text-slate-400 mt-1">Live vertical shorts</p>
                    </div>
                  </div>

                  {/* SVG Chart Container */}
                  <div className="glass-panel rounded-3xl p-6 flex flex-col gap-4 border border-white/5 shadow-xl relative">
                    <div className="flex justify-between items-center pb-3 border-b border-white/5">
                      <div>
                        <h3 className="font-bold text-slate-200 text-sm font-display">Performance Chart (30 Days)</h3>
                        <p className="text-[11px] text-slate-450 mt-0.5">Interactive line analysis of daily channel metrics</p>
                      </div>

                      <div className="flex bg-white/3 p-0.5 rounded-xl border border-white/5">
                        {(['views', 'subscribers', 'revenue'] as const).map((metric) => (
                          <button
                            key={metric}
                            onClick={() => setStatsMetric(metric)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer ${
                              statsMetric === metric
                                ? 'bg-gradient-to-r from-neon-cyan to-neon-emerald text-slate-900 shadow-md'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {metric}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Render Interactive SVG Chart */}
                    {(() => {
                      if (!channelStats || !channelStats.historical_data || channelStats.historical_data.length === 0) {
                        return <div className="text-xs text-slate-500 italic p-6 text-center">No historical data available.</div>;
                      }

                      const data = channelStats.historical_data;
                      const width = 800;
                      const height = 300;
                      const padding = 20;

                      let values: number[] = [];
                      if (statsMetric === 'views') {
                        values = data.map((d: any) => d.views_gain);
                      } else if (statsMetric === 'subscribers') {
                        values = data.map((d: any) => d.subscribers);
                      } else {
                        values = data.map((d: any) => d.estimated_revenue);
                      }

                      const min = Math.min(...values);
                      const max = Math.max(...values);
                      const range = max - min || 1;

                      const points = data.map((d: any, i: number) => {
                        const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
                        const val = statsMetric === 'views' ? d.views_gain : statsMetric === 'subscribers' ? d.subscribers : d.estimated_revenue;
                        const y = height - padding - ((val - min) / range) * (height - 2 * padding);
                        return { x, y, value: val, label: d.day };
                      });

                      const path = points.map((p: any, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                      const area = `${path} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

                      return (
                        <div className="relative w-full overflow-hidden select-none">
                          <div className="absolute right-0 top-0 text-[10px] text-slate-500 font-mono font-bold flex flex-col items-end pr-2 pt-2 gap-1 pointer-events-none">
                            <span>MAX: {statsMetric === 'revenue' ? '$' : ''}{max.toLocaleString()}</span>
                            <span>MIN: {statsMetric === 'revenue' ? '$' : ''}{min.toLocaleString()}</span>
                          </div>

                          <svg
                            viewBox={`0 0 ${width} ${height}`}
                            className="w-full h-auto overflow-visible"
                          >
                            <defs>
                              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#05ffc5" stopOpacity="0.0" />
                              </linearGradient>
                              <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#00f2fe" />
                                <stop offset="100%" stopColor="#05ffc5" />
                              </linearGradient>
                            </defs>

                            {/* Horizontal Grid Lines */}
                            {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
                              const y = padding + ratio * (height - 2 * padding);
                              return (
                                <line
                                  key={index}
                                  x1={padding}
                                  y1={y}
                                  x2={width - padding}
                                  y2={y}
                                  stroke="rgba(255,255,255,0.04)"
                                  strokeDasharray="4,4"
                                  strokeWidth="1"
                                />
                              );
                            })}

                            {/* Area Fill */}
                            {area && (
                              <path
                                d={area}
                                fill="url(#chartGrad)"
                              />
                            )}

                            {/* Line Path */}
                            {path && (
                              <path
                                d={path}
                                fill="none"
                                stroke="url(#lineGrad)"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="drop-shadow-[0_2px_8px_rgba(0,242,254,0.3)]"
                              />
                            )}

                            {/* Interactive Points */}
                            {points.map((p: any, i: number) => {
                              const isHovered = hoveredPoint && hoveredPoint.index === i;
                              return (
                                <g key={i}>
                                  <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={isHovered ? 6 : 3.5}
                                    fill={isHovered ? '#05ffc5' : '#00f2fe'}
                                    stroke="rgba(7,9,14,0.9)"
                                    strokeWidth={isHovered ? 2.5 : 1.5}
                                    className="cursor-pointer transition-all duration-150"
                                    onMouseEnter={() => setHoveredPoint({ ...p, index: i })}
                                    onMouseLeave={() => setHoveredPoint(null)}
                                  />
                                </g>
                              );
                            })}
                          </svg>

                          {/* Hover Tooltip Card */}
                          {hoveredPoint && (
                            <div
                              className="absolute bg-[#0b0f19]/95 border border-white/10 rounded-xl p-2.5 shadow-xl text-[10px] backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
                              style={{
                                left: `${(hoveredPoint.x / width) * 100}%`,
                                top: `${(hoveredPoint.y / height) * 100 - 15}%`,
                                transform: 'translate(-50%, -100%)',
                                pointerEvents: 'none'
                              }}
                            >
                              <span className="block text-slate-500 font-mono font-bold uppercase">{hoveredPoint.label}</span>
                              <span className="block text-xs font-bold text-white mt-0.5">
                                {statsMetric === 'revenue' ? '$' : ''}
                                {hoveredPoint.value?.toLocaleString()}
                                {statsMetric === 'views' ? ' views' : statsMetric === 'subscribers' ? ' subs' : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <div className="text-center text-xs text-slate-500 italic p-6">No data loaded.</div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* INSPECTOR MODAL */}
      {selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-5xl h-full bg-[#06080d]/97 backdrop-blur-xl border-l border-white/6 flex flex-col shadow-[0_0_80px_rgba(0,0,0,0.9)] relative overflow-hidden">

            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/40 to-transparent flex-shrink-0" />

            {/* Header */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/2 flex-shrink-0">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[9px] uppercase text-neon-cyan font-bold tracking-[0.2em] font-mono">Run Inspector</span>
                  <h2 className="text-sm font-bold text-white mt-0.5 font-display leading-tight">{selectedRun.id}</h2>
                </div>
                <div className="hidden md:flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[9px] font-bold font-mono rounded-md bg-neon-cyan/8 border border-neon-cyan/15 text-neon-cyan">
                    {selectedRun.images.length} SCENES
                  </span>
                  {selectedRun.videos.length > 0 && (
                    <span className="px-2 py-0.5 text-[9px] font-bold font-mono rounded-md bg-neon-emerald/8 border border-neon-emerald/15 text-neon-emerald">
                      VIDEO READY
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedRun(null)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col lg:flex-row gap-5">

              {/* ── LEFT COLUMN ── */}
              <div className="flex-1 flex flex-col gap-5 min-w-0">

                {/* Scene Thumbnail Strip */}
                {editPrompts.length > 0 && (
                  <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                      <h3 className="font-bold text-white text-xs font-display tracking-wide flex items-center gap-2">
                        <Video size={13} className="text-neon-cyan" />
                        <span>Scene Selector</span>
                      </h3>
                      <span className="text-[9px] font-mono text-slate-500">{editPrompts.length} scenes</span>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                      {editPrompts.map((_, idx) => {
                        const isSelected = selectedSceneIndex === idx;
                        const img = selectedRun.images[idx];
                        return (
                          <button
                            key={idx}
                            onClick={() => setSelectedSceneIndex(idx)}
                            className={`flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border transition-all relative group ${
                              isSelected
                                ? 'border-neon-cyan ring-2 ring-neon-cyan/30 shadow-[0_0_12px_rgba(0,242,254,0.25)] scale-95'
                                : 'border-white/8 hover:border-white/20'
                            }`}
                            title={`Scene ${idx + 1}`}
                          >
                            {img ? (
                              <img
                                src={`/api/runs/${selectedRun.id}/files/images/${img}`}
                                alt={`Scene ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-slate-900/80 flex items-center justify-center">
                                <Video size={12} className="text-slate-600" />
                              </div>
                            )}
                            <div className="absolute bottom-0.5 right-0.5 bg-black/80 text-[7px] text-white font-bold font-mono px-0.5 rounded leading-none">
                              {idx + 1}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Scene Editor */}
                <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3 border-l-2 border-neon-cyan bg-neon-cyan/2">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <h3 className="font-bold text-white text-xs font-display">
                      Scene Beat {selectedSceneIndex + 1} of {editPrompts.length || selectedRun.images.length}
                    </h3>
                    <button
                      onClick={() => handleRegenerateScene(selectedSceneIndex + 1)}
                      disabled={regeneratingScene}
                      className="flex items-center gap-1 py-1 px-2.5 bg-neon-cyan/12 hover:bg-neon-cyan text-neon-cyan hover:text-slate-950 border border-neon-cyan/25 text-[10px] font-bold rounded-lg transition-all font-mono disabled:opacity-50 cursor-pointer"
                    >
                      {regeneratingScene ? (
                        <><RefreshCw size={11} className="animate-spin" /><span>Regenerating...</span></>
                      ) : (
                        <><RefreshCw size={11} /><span>Regenerate Visual</span></>
                      )}
                    </button>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1.5 font-mono">Visual Prompt</label>
                    <textarea
                      rows={3}
                      value={editPrompts[selectedSceneIndex] || ''}
                      onChange={(e) => {
                        const updated = [...editPrompts];
                        updated[selectedSceneIndex] = e.target.value;
                        setEditPrompts(updated);
                      }}
                      disabled={regeneratingScene}
                      className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 leading-relaxed text-slate-200 resize-none"
                    />
                  </div>
                  {selectedRun.images[selectedSceneIndex] && (
                    <div className="flex gap-3 items-start">
                      <img
                        src={`/api/runs/${selectedRun.id}/files/images/${selectedRun.images[selectedSceneIndex]}`}
                        alt={`Scene ${selectedSceneIndex + 1}`}
                        className="w-20 h-20 object-cover rounded-xl border border-neon-cyan/20 flex-shrink-0"
                      />
                      <div className="flex flex-col gap-1 text-[9px] font-mono text-slate-500">
                        <span className="text-neon-cyan font-bold">Scene {selectedSceneIndex + 1}</span>
                        <span className="break-all">{selectedRun.images[selectedSceneIndex]}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Script & Story Editor */}
                <div className="glass-panel rounded-2xl p-4 flex flex-col gap-4">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <h3 className="font-bold text-slate-200 text-xs font-display">Script & Story</h3>
                    <div className="flex items-center gap-2">
                      {selectedRun.script?.variants && Object.keys(selectedRun.script.variants).length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-slate-500 font-mono font-bold">Variant</span>
                          <select
                            value={selectedVariant || ''}
                            onChange={(e) => handleVariantChange(e.target.value)}
                            className="bg-white/5 border border-white/5 text-xs font-bold font-mono text-slate-200 rounded-lg px-2 py-1 focus:outline-none"
                          >
                            {Object.keys(selectedRun.script.variants).map((lang) => (
                              <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <button
                        onClick={handleSaveScript}
                        disabled={savingScript}
                        className="flex items-center gap-1 py-1.5 px-3 bg-gradient-to-r from-neon-cyan to-neon-emerald text-slate-900 text-[10px] font-bold rounded-lg transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer font-mono"
                      >
                        {savingScript ? (
                          <><RefreshCw size={11} className="animate-spin" /><span>Compiling...</span></>
                        ) : (
                          <><Save size={11} /><span>Save & Re-render</span></>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1.5 font-mono">YouTube Title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        disabled={savingScript}
                        className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1.5 font-mono">YouTube Description</label>
                      <input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        disabled={savingScript}
                        className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 text-slate-200 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1.5 font-mono">Full Narration (Spoken)</label>
                    <textarea
                      rows={5}
                      value={editNarration}
                      onChange={(e) => setEditNarration(e.target.value)}
                      disabled={savingScript}
                      className="w-full bg-white/3 border border-white/5 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30 leading-relaxed text-slate-200 resize-none"
                    />
                  </div>
                </div>

              </div>

              {/* ── RIGHT COLUMN ── */}
              <div className="w-full lg:w-72 flex flex-col gap-4 flex-shrink-0">

                {/* Video Player */}
                <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3">
                  <h3 className="font-bold text-slate-200 text-xs flex items-center gap-1.5 font-display">
                    <PlayCircle size={14} className="text-neon-cyan" />
                    <span>Video Preview</span>
                  </h3>

                  {selectedRun.videos.length > 0 ? (
                    <div className="aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/5 shadow-[0_0_30px_rgba(0,242,254,0.05)]">
                      <video
                        ref={videoRef}
                        controls
                        preload="metadata"
                        src={`/api/runs/${selectedRun.id}/files/${selectedRun.videos[0]}`}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="aspect-[9/16] bg-slate-950/50 border border-white/5 border-dashed rounded-xl flex flex-col items-center justify-center p-4 text-center">
                      <Video size={28} className="text-slate-700 mb-2" />
                      <span className="text-xs text-slate-400 font-medium">No Video Found</span>
                      <p className="text-[10px] text-slate-600 mt-0.5">Run hasn't generated a video yet.</p>
                    </div>
                  )}
                </div>

                {/* YouTube Publisher */}
                {selectedRun.videos.length > 0 && (
                  <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3">
                    <h3 className="font-bold text-slate-200 text-xs flex items-center gap-1.5 font-display">
                      <Upload size={13} className="text-neon-cyan" />
                      <span>YouTube Publisher</span>
                    </h3>

                    <div className="flex flex-col gap-2">
                      <div>
                        <label className="block text-[9px] text-slate-500 uppercase font-bold mb-1 font-mono">Privacy</label>
                        <select
                          value={manualUploadPrivacy}
                          onChange={(e) => setManualUploadPrivacy(e.target.value as any)}
                          className="w-full bg-white/3 border border-white/5 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-neon-cyan"
                        >
                          <option value="private">Private</option>
                          <option value="unlisted">Unlisted</option>
                          <option value="public">Public</option>
                        </select>
                      </div>

                      <button
                        onClick={handleManualUpload}
                        disabled={manualUploading}
                        className={`w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                          manualUploading
                            ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 cursor-not-allowed'
                            : 'bg-gradient-to-r from-neon-cyan to-neon-emerald text-slate-900 hover:opacity-90 font-mono'
                        }`}
                      >
                        {manualUploading ? (
                          <><RefreshCw size={13} className="animate-spin" /><span>Uploading...</span></>
                        ) : (
                          <><Upload size={13} /><span>Upload to YouTube</span></>
                        )}
                      </button>

                      {manualUploadUrls.length > 0 && (
                        <div className="p-2.5 bg-emerald-950/20 border border-emerald-500/20 rounded-lg flex flex-col gap-1.5">
                          <span className="text-[9px] text-neon-emerald font-bold uppercase font-mono">✓ Uploaded!</span>
                          {manualUploadUrls.map((url, i) => (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-neon-cyan hover:text-neon-emerald underline flex items-center gap-1 font-mono"
                            >
                              <span>View on YouTube</span>
                              <ExternalLink size={9} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Generated Images Grid */}
                <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3">
                  <h3 className="font-bold text-slate-200 text-xs font-display">
                    Generated Images ({selectedRun.images.length})
                  </h3>
                  {selectedRun.images.length > 0 ? (
                    <div className="grid grid-cols-3 gap-1.5 max-h-60 overflow-y-auto pr-0.5">
                      {selectedRun.images.map((imgName, index) => (
                        <button
                          key={imgName}
                          onClick={() => setSelectedSceneIndex(index)}
                          className={`aspect-square bg-slate-950 rounded-lg overflow-hidden border group relative transition-all ${
                            selectedSceneIndex === index
                              ? 'border-neon-cyan ring-2 ring-neon-cyan/20 scale-95'
                              : 'border-white/5 hover:border-white/20'
                          }`}
                        >
                          <img
                            src={`/api/runs/${selectedRun.id}/files/images/${imgName}`}
                            alt={imgName}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute bottom-0.5 right-0.5 bg-black/80 text-[7px] text-white font-bold font-mono px-0.5 rounded leading-none">
                            {index + 1}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 italic p-3 text-center">No images found.</div>
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
