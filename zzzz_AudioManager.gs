/*
 * Global BGM manager for menu, battle, and reward music.
 *
 * Existing Battle.html already handles short SFX with BATTLE_SOUND_FILES. This
 * file adds looped BGM tracks through a small client-side wrapper injected with
 * UiLoadingModal so every page can share the same behavior without rewriting the
 * individual templates.
 */

(function installLearningRpgAudioManagerPatch_() {
  if (typeof LEARNING_RPG_AUDIO_MANAGER_PATCH_INSTALLED_ !== 'undefined' && LEARNING_RPG_AUDIO_MANAGER_PATCH_INSTALLED_) {
    return;
  }

  if (typeof include_ === 'function') {
    INCLUDE_ORIGINAL_AUDIO_MANAGER_ = include_;
    include_ = function(filename) {
      var html = INCLUDE_ORIGINAL_AUDIO_MANAGER_(filename);
      if (String(filename || '') === 'UiLoadingModal') {
        html += getLearningRpgAudioManagerClientPatch_();
      }
      return html;
    };
  }

  LEARNING_RPG_AUDIO_MANAGER_PATCH_INSTALLED_ = true;
})();

function getLearningRpgAudioManagerClientPatch_() {
  var assetBase = '';
  try {
    assetBase = typeof getAssetBaseUrl_ === 'function' ? String(getAssetBaseUrl_() || '') : '';
  } catch (error) {
    assetBase = '';
  }

  return '<script>\n' +
    '(function(){\n' +
    '  var AUDIO_ASSET_BASE = \'' + escapeAudioManagerJsString_(assetBase) + '\';\n' +
    '  var STORAGE_INTENT_KEY = "learningRpgAudioIntent";\n' +
    '  var SOUND_ENABLED_KEY = "learningRpgSoundEnabled";\n' +
    '  var DEFAULT_FADE_MS = 900;\n' +
    '  var DEFAULT_VOLUME = 0.52;\n' +
    '  var RAIN_AMBIENCE_VOLUME = 0.3;\n' +
    '  var RAIN_AMBIENCE_MIN_FLOOR = 3;\n' +
    '  var RAIN_AMBIENCE_PATH = "Resources/Sounds/Rain.mp3";\n' +
    '  var currentTrack = null;\n' +
    '  var rainAmbienceAudio = null;\n' +
    '  var rainAmbiencePending = false;\n' +
    '  var audioUnlocked = false;\n' +
    '  var pendingIntent = null;\n' +
    '\n' +
    '  function assetUrl(path){\n' +
    '    var base = String(AUDIO_ASSET_BASE || (window.ASSET_BASE_URL || "")).replace(/\\/+$/, "");\n' +
    '    var cleanPath = String(path || "").replace(/^\\/+/, "");\n' +
    '    return base ? base + "/" + cleanPath : cleanPath;\n' +
    '  }\n' +
    '\n' +
    '  function normalizePathList(paths){\n' +
    '    var seen = {};\n' +
    '    return (paths || []).map(function(path){ return String(path || "").trim(); }).filter(function(path){\n' +
    '      if (!path || seen[path]) return false;\n' +
    '      seen[path] = true;\n' +
    '      return true;\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  function buildBattleBgmPaths(floor){\n' +
    '    var normalizedFloor = Math.max(1, Math.min(5, Math.round(Number(floor || 1))));\n' +
    '    return normalizePathList([\n' +
    '      "Resources/Sounds/BGM/Battle/" + normalizedFloor + ".wav",\n' +
    '      "Resources/Sounds/BGM/Battle/1.wav",\n' +
    '      "Resources/Sounds/BGM/Battle/2.wav",\n' +
    '      "Resources/Sounds/BGM/Battle/3.wav",\n' +
    '      "Resources/Sounds/BGM/Battle/4.wav",\n' +
    '      "Resources/Sounds/BGM/Battle/5.wav"\n' +
    '    ]);\n' +
    '  }\n' +
    '\n' +
    '  function makeIntent(kind, options){\n' +
    '    options = options || {};\n' +
    '    if (kind === "battle") {\n' +
    '      var floor = Math.max(1, Math.min(5, Math.round(Number(options.floor || 1))));\n' +
    '      return { kind: "battle", key: "battle:" + floor, floor: floor, volume: 0.5, paths: buildBattleBgmPaths(floor) };\n' +
    '    }\n' +
    '    if (kind === "reward") {\n' +
    '      return { kind: "reward", key: "reward", volume: 0.48, paths: ["Resources/Sounds/BGM/Battle/Reward.wav"] };\n' +
    '    }\n' +
    '    return { kind: "main", key: "main", volume: 0.42, paths: ["Resources/Sounds/BGM/Main.wav"] };\n' +
    '  }\n' +
    '\n' +
    '  function rememberIntent(intent){\n' +
    '    try { window.localStorage.setItem(STORAGE_INTENT_KEY, JSON.stringify({ kind: intent.kind, floor: intent.floor || 0, key: intent.key || "" })); } catch (error) {}\n' +
    '  }\n' +
    '\n' +
    '  function isSoundEnabled(){\n' +
    '    try { return window.localStorage.getItem(SOUND_ENABLED_KEY) === "1"; } catch (error) { return false; }\n' +
    '  }\n' +
    '\n' +
    '  function fadeAudio(audio, targetVolume, durationMs, onDone){\n' +
    '    if (!audio) { if (onDone) onDone(); return; }\n' +
    '    if (audio.__learningRpgFadeTimer) {\n' +
    '      window.clearInterval(audio.__learningRpgFadeTimer);\n' +
    '      audio.__learningRpgFadeTimer = null;\n' +
    '    }\n' +
    '    var startVolume = Number(audio.volume || 0);\n' +
    '    var target = Math.max(0, Math.min(1, Number(targetVolume || 0)));\n' +
    '    var duration = Math.max(0, Number(durationMs || 0));\n' +
    '    if (!duration) {\n' +
    '      audio.volume = target;\n' +
    '      if (onDone) onDone();\n' +
    '      return;\n' +
    '    }\n' +
    '    var startedAt = Date.now();\n' +
    '    audio.__learningRpgFadeTimer = window.setInterval(function(){\n' +
    '      var progress = Math.min(1, (Date.now() - startedAt) / duration);\n' +
    '      audio.volume = startVolume + ((target - startVolume) * progress);\n' +
    '      if (progress >= 1) {\n' +
    '        window.clearInterval(audio.__learningRpgFadeTimer);\n' +
    '        audio.__learningRpgFadeTimer = null;\n' +
    '        if (onDone) onDone();\n' +
    '      }\n' +
    '    }, 40);\n' +
    '  }\n' +
    '\n' +
    '  function stopCurrentTrack(fadeMs){\n' +
    '    var track = currentTrack;\n' +
    '    if (!track || !track.audio) { currentTrack = null; return; }\n' +
    '    currentTrack = null;\n' +
    '    fadeAudio(track.audio, 0, fadeMs === undefined ? DEFAULT_FADE_MS : fadeMs, function(){\n' +
    '      try { track.audio.pause(); track.audio.removeAttribute("src"); track.audio.load(); } catch (error) {}\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  function playIntent(intent, fadeMs){\n' +
    '    intent = intent || makeIntent("main");\n' +
    '    intent.paths = normalizePathList(intent.paths || []);\n' +
    '    if (!intent.paths.length) return;\n' +
    '    pendingIntent = intent;\n' +
    '    rememberIntent(intent);\n' +
    '    if (!isSoundEnabled()) {\n' +
    '      stopCurrentTrack(0);\n' +
    '      return;\n' +
    '    }\n' +
    '    if (currentTrack && currentTrack.key === intent.key && currentTrack.audio && !currentTrack.audio.paused) {\n' +
    '      fadeAudio(currentTrack.audio, intent.volume || DEFAULT_VOLUME, fadeMs === undefined ? 300 : fadeMs);\n' +
    '      return;\n' +
    '    }\n' +
    '    stopCurrentTrack(fadeMs === undefined ? DEFAULT_FADE_MS : fadeMs);\n' +
    '    startIntentAtPath(intent, 0, fadeMs === undefined ? DEFAULT_FADE_MS : fadeMs);\n' +
    '  }\n' +
    '\n' +
    '  function startIntentAtPath(intent, pathIndex, fadeMs){\n' +
    '    var paths = intent.paths || [];\n' +
    '    if (!isSoundEnabled()) { pendingIntent = intent; return; }\n' +
    '    if (pathIndex >= paths.length) { pendingIntent = intent; return; }\n' +
    '    var audio = new Audio(assetUrl(paths[pathIndex]));\n' +
    '    audio.loop = intent.kind !== "reward";\n' +
    '    audio.preload = "auto";\n' +
    '    audio.volume = 0;\n' +
    '    audio.muted = !isSoundEnabled();\n' +
    '    if (intent.kind === "reward") {\n' +
    '      audio.addEventListener("ended", function(){\n' +
    '        if (currentTrack && currentTrack.audio === audio) {\n' +
    '          currentTrack = null;\n' +
    '        }\n' +
    '      }, { once: true });\n' +
    '    }\n' +
    '    audio.addEventListener("error", function(){\n' +
    '      if (currentTrack && currentTrack.audio === audio) {\n' +
    '        currentTrack = null;\n' +
    '      }\n' +
    '      try { audio.pause(); } catch (error) {}\n' +
    '      startIntentAtPath(intent, pathIndex + 1, fadeMs);\n' +
    '    }, { once: true });\n' +
    '    currentTrack = { key: intent.key, kind: intent.kind, audio: audio, path: paths[pathIndex] };\n' +
    '    var playPromise;\n' +
    '    try { playPromise = audio.play(); } catch (error) {\n' +
    '      pendingIntent = intent;\n' +
    '      return;\n' +
    '    }\n' +
    '    if (playPromise && playPromise.then) {\n' +
    '      playPromise.then(function(){\n' +
    '        audioUnlocked = true;\n' +
    '        pendingIntent = null;\n' +
    '        if (!isSoundEnabled()) { stopCurrentTrack(0); return; }\n' +
    '        fadeAudio(audio, intent.volume || DEFAULT_VOLUME, fadeMs);\n' +
    '      }).catch(function(){\n' +
    '        pendingIntent = intent;\n' +
    '      });\n' +
    '    } else {\n' +
    '      audioUnlocked = true;\n' +
    '      pendingIntent = null;\n' +
    '      if (!isSoundEnabled()) { stopCurrentTrack(0); return; }\n' +
    '      fadeAudio(audio, intent.volume || DEFAULT_VOLUME, fadeMs);\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  function getBattleFloor(){\n' +
    '    var battle = window.currentView && window.currentView.battle || {};\n' +
    '    var stage = battle.stage || {};\n' +
    '    return Math.max(1, Math.min(5, Math.round(Number(stage.floor || 1))));\n' +
    '  }\n' +
    '\n' +
    '  function isBattlePage(){ return !!document.getElementById("battleShell"); }\n' +
    '\n' +
    '  function shouldPlayRainAmbience(){\n' +
    '    return isBattlePage() && getBattleFloor() >= RAIN_AMBIENCE_MIN_FLOOR;\n' +
    '  }\n' +
    '\n' +
    '  function stopRainAmbience(fadeMs){\n' +
    '    rainAmbiencePending = false;\n' +
    '    var audio = rainAmbienceAudio;\n' +
    '    if (!audio) return;\n' +
    '    rainAmbienceAudio = null;\n' +
    '    fadeAudio(audio, 0, fadeMs === undefined ? DEFAULT_FADE_MS : fadeMs, function(){\n' +
    '      try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (error) {}\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  function syncRainAmbience(fadeMs){\n' +
    '    if (!shouldPlayRainAmbience()) {\n' +
    '      stopRainAmbience(fadeMs === undefined ? DEFAULT_FADE_MS : fadeMs);\n' +
    '      return;\n' +
    '    }\n' +
    '    if (!isSoundEnabled()) {\n' +
    '      stopRainAmbience(0);\n' +
    '      return;\n' +
    '    }\n' +
    '    if (rainAmbienceAudio && !rainAmbienceAudio.paused) {\n' +
    '      rainAmbienceAudio.muted = false;\n' +
    '      fadeAudio(rainAmbienceAudio, RAIN_AMBIENCE_VOLUME, fadeMs === undefined ? 360 : fadeMs);\n' +
    '      return;\n' +
    '    }\n' +
    '    stopRainAmbience(0);\n' +
    '    try {\n' +
    '      var audio = new Audio(assetUrl(RAIN_AMBIENCE_PATH));\n' +
    '      audio.loop = true;\n' +
    '      audio.preload = "auto";\n' +
    '      audio.volume = 0;\n' +
    '      audio.muted = false;\n' +
    '      audio.__learningRpgSkipSfxVolume = true;\n' +
    '      rainAmbienceAudio = audio;\n' +
    '      audio.addEventListener("error", function(){\n' +
    '        if (rainAmbienceAudio === audio) {\n' +
    '          rainAmbienceAudio = null;\n' +
    '          rainAmbiencePending = false;\n' +
    '        }\n' +
    '      }, { once: true });\n' +
    '      var playPromise = audio.play();\n' +
    '      if (playPromise && playPromise.then) {\n' +
    '        playPromise.then(function(){\n' +
    '          audioUnlocked = true;\n' +
    '          rainAmbiencePending = false;\n' +
    '          if (!isSoundEnabled() || !shouldPlayRainAmbience()) { stopRainAmbience(0); return; }\n' +
    '          fadeAudio(audio, RAIN_AMBIENCE_VOLUME, fadeMs === undefined ? DEFAULT_FADE_MS : fadeMs);\n' +
    '        }).catch(function(){\n' +
    '          if (rainAmbienceAudio === audio) {\n' +
    '            rainAmbiencePending = true;\n' +
    '          }\n' +
    '        });\n' +
    '      } else {\n' +
    '        audioUnlocked = true;\n' +
    '        rainAmbiencePending = false;\n' +
    '        fadeAudio(audio, RAIN_AMBIENCE_VOLUME, fadeMs === undefined ? DEFAULT_FADE_MS : fadeMs);\n' +
    '      }\n' +
    '    } catch (error) {\n' +
    '      rainAmbienceAudio = null;\n' +
    '      rainAmbiencePending = true;\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  function requestMainBgm(){ playIntent(makeIntent("main")); }\n' +
    '  function requestBattleBgm(){ playIntent(makeIntent("battle", { floor: getBattleFloor() })); }\n' +
    '  function requestRewardBgm(){ playIntent(makeIntent("reward")); }\n' +
    '\n' +
    '  function unlockAudio(){\n' +
    '    if (!isSoundEnabled()) return;\n' +
    '    audioUnlocked = true;\n' +
    '    if (pendingIntent) {\n' +
    '      playIntent(pendingIntent, 360);\n' +
    '      syncRainAmbience(360);\n' +
    '      return;\n' +
    '    }\n' +
    '    if (!isBattlePage()) {\n' +
    '      requestMainBgm();\n' +
    '    }\n' +
    '    if (rainAmbiencePending || shouldPlayRainAmbience()) {\n' +
    '      syncRainAmbience(360);\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  function installUnlockListeners(){\n' +
    '    ["pointerdown", "click", "keydown", "touchstart"].forEach(function(eventName){\n' +
    '      document.addEventListener(eventName, unlockAudio, { passive: true });\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  function patchFunction(name, wrapper){\n' +
    '    var attempts = 0;\n' +
    '    var timer = window.setInterval(function(){\n' +
    '      attempts += 1;\n' +
    '      var original = window[name];\n' +
    '      if (typeof original === "function" && !original.__learningRpgAudioPatched) {\n' +
    '        var patched = wrapper(original);\n' +
    '        patched.__learningRpgAudioPatched = true;\n' +
    '        window[name] = patched;\n' +
    '        window.clearInterval(timer);\n' +
    '        return;\n' +
    '      }\n' +
    '      if (attempts > 240) {\n' +
    '        window.clearInterval(timer);\n' +
    '      }\n' +
    '    }, 40);\n' +
    '  }\n' +
    '\n' +
    '  function installMenuPatches(){\n' +
    '    patchFunction("transitionToBattlePage", function(original){\n' +
    '      return function(){\n' +
    '        stopCurrentTrack(DEFAULT_FADE_MS);\n' +
    '        stopRainAmbience(DEFAULT_FADE_MS);\n' +
    '        return original.apply(this, arguments);\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("goToPage", function(original){\n' +
    '      return function(page){\n' +
    '        if (String(page || "") === "battle") {\n' +
    '          stopCurrentTrack(DEFAULT_FADE_MS);\n' +
    '        } else if (!isBattlePage() && isSoundEnabled()) {\n' +
    '          requestMainBgm();\n' +
    '          stopRainAmbience(DEFAULT_FADE_MS);\n' +
    '        }\n' +
    '        return original.apply(this, arguments);\n' +
    '      };\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  function installBattlePatches(){\n' +
    '    if (!isBattlePage()) return;\n' +
    '    patchFunction("renderBattle", function(original){\n' +
    '      return function(){\n' +
    '        var result = original.apply(this, arguments);\n' +
    '        syncRainAmbience(420);\n' +
    '        return result;\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("startBattleEntrance", function(original){\n' +
    '      return function(){\n' +
    '        stopCurrentTrack(DEFAULT_FADE_MS);\n' +
    '        return original.apply(this, arguments);\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("skipStageEntranceIntro", function(original){\n' +
    '      return function(){\n' +
    '        var result = original.apply(this, arguments);\n' +
    '        requestBattleBgm();\n' +
    '        return result;\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("revealStageEntranceMonsters", function(original){\n' +
    '      return function(){\n' +
    '        var result = original.apply(this, arguments);\n' +
    '        requestBattleBgm();\n' +
    '        return result;\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("startFloorIntermissionEntrance", function(original){\n' +
    '      return function(){\n' +
    '        stopCurrentTrack(DEFAULT_FADE_MS);\n' +
    '        syncRainAmbience(DEFAULT_FADE_MS);\n' +
    '        return original.apply(this, arguments);\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("renderRewardChoices", function(original){\n' +
    '      return function(){\n' +
    '        var result = original.apply(this, arguments);\n' +
    '        requestRewardBgm();\n' +
    '        syncRainAmbience(360);\n' +
    '        return result;\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("showDefeatSequence", function(original){\n' +
    '      return function(){\n' +
    '        stopCurrentTrack(DEFAULT_FADE_MS);\n' +
    '        stopRainAmbience(DEFAULT_FADE_MS);\n' +
    '        return original.apply(this, arguments);\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("goHome", function(original){\n' +
    '      return function(){\n' +
    '        stopRainAmbience(DEFAULT_FADE_MS);\n' +
    '        return original.apply(this, arguments);\n' +
    '      };\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  function routeInitialAudio(){\n' +
    '    if (!isSoundEnabled()) return;\n' +
    '    if (isBattlePage()) {\n' +
    '      stopCurrentTrack(240);\n' +
    '      syncRainAmbience(240);\n' +
    '      return;\n' +
    '    }\n' +
    '    requestMainBgm();\n' +
    '  }\n' +
    '\n' +
    '  function applySoundPreference(){\n' +
    '    if (!isSoundEnabled()) {\n' +
    '      if (currentTrack && !pendingIntent) {\n' +
    '        if (currentTrack.kind === "battle") pendingIntent = makeIntent("battle", { floor: getBattleFloor() });\n' +
    '        else pendingIntent = makeIntent(currentTrack.kind || "main");\n' +
    '      }\n' +
    '      stopCurrentTrack(0);\n' +
    '      stopRainAmbience(0);\n' +
    '      return;\n' +
    '    }\n' +
    '    if (pendingIntent) {\n' +
    '      playIntent(pendingIntent, 240);\n' +
    '    } else if (!isBattlePage()) {\n' +
    '      requestMainBgm();\n' +
    '    } else {\n' +
    '      requestBattleBgm();\n' +
    '    }\n' +
    '    syncRainAmbience(240);\n' +
    '  }\n' +
    '\n' +
    '  function install(){\n' +
    '    if (window.__learningRpgAudioManagerInstalled) return;\n' +
    '    window.__learningRpgAudioManagerInstalled = true;\n' +
    '    window.LEARNING_RPG_AUDIO = {\n' +
    '      playMain: requestMainBgm,\n' +
    '      playBattle: requestBattleBgm,\n' +
    '      playReward: requestRewardBgm,\n' +
    '      stop: function(ms){ stopCurrentTrack(ms === undefined ? DEFAULT_FADE_MS : ms); },\n' +
    '      syncRainAmbience: syncRainAmbience,\n' +
    '      applySoundPreference: applySoundPreference,\n' +
    '      getCurrent: function(){ return currentTrack ? { key: currentTrack.key, kind: currentTrack.kind, path: currentTrack.path } : null; }\n' +
    '    };\n' +
    '    window.addEventListener("storage", function(event){ if (event.key === SOUND_ENABLED_KEY) applySoundPreference(); });\n' +
    '    window.addEventListener("learningRpgSoundPreferenceChanged", applySoundPreference);\n' +
    '    installUnlockListeners();\n' +
    '    installMenuPatches();\n' +
    '    installBattlePatches();\n' +
    '    window.setTimeout(routeInitialAudio, 120);\n' +
    '  }\n' +
    '\n' +
    '  if (document.readyState === "loading") {\n' +
    '    document.addEventListener("DOMContentLoaded", install);\n' +
    '  } else {\n' +
    '    install();\n' +
    '  }\n' +
    '})();\n' +
    '</script>';
}

function escapeAudioManagerJsString_(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/<\//g, '<\\/');
}
