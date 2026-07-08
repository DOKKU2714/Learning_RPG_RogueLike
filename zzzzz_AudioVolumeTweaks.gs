/*
 * Follow-up audio tweaks.
 *
 * - Reduce non-BGM sound effects to about 70% volume.
 * - Keep Reward.wav as a one-shot reward jingle instead of an infinite loop.
 */

(function installLearningRpgAudioVolumeTweaksPatch_() {
  if (typeof LEARNING_RPG_AUDIO_VOLUME_TWEAKS_INSTALLED_ !== 'undefined' && LEARNING_RPG_AUDIO_VOLUME_TWEAKS_INSTALLED_) {
    return;
  }

  if (typeof include_ === 'function') {
    INCLUDE_ORIGINAL_AUDIO_VOLUME_TWEAKS_ = include_;
    include_ = function(filename) {
      var html = INCLUDE_ORIGINAL_AUDIO_VOLUME_TWEAKS_(filename);
      if (String(filename || '') === 'UiLoadingModal') {
        html += getLearningRpgAudioVolumeTweaksClientPatch_();
      }
      return html;
    };
  }

  LEARNING_RPG_AUDIO_VOLUME_TWEAKS_INSTALLED_ = true;
})();

function getLearningRpgAudioVolumeTweaksClientPatch_() {
  var assetBase = '';
  try {
    assetBase = typeof getAssetBaseUrl_ === 'function' ? String(getAssetBaseUrl_() || '') : '';
  } catch (error) {
    assetBase = '';
  }

  return '<script>\n' +
    '(function(){\n' +
    '  var AUDIO_ASSET_BASE = \'' + escapeAudioVolumeTweaksJsString_(assetBase) + '\';\n' +
    '  var SOUND_ENABLED_KEY = "learningRpgSoundEnabled";\n' +
    '  var SFX_VOLUME_MULTIPLIER = 0.7;\n' +
    '  var REWARD_ONE_SHOT_VOLUME = 0.48;\n' +
    '  var rewardOneShotAudio = null;\n' +
    '  var lastRewardOneShotAt = 0;\n' +
    '\n' +
    '  function assetUrl(path){\n' +
    '    var base = String(AUDIO_ASSET_BASE || (window.ASSET_BASE_URL || "")).replace(/\\/+$/, "");\n' +
    '    var cleanPath = String(path || "").replace(/^\\/+/, "");\n' +
    '    return base ? base + "/" + cleanPath : cleanPath;\n' +
    '  }\n' +
    '\n' +
    '  function isAudioElement(element){\n' +
    '    return !!element && (element.tagName === "AUDIO" || (window.HTMLAudioElement && element instanceof HTMLAudioElement));\n' +
    '  }\n' +
    '\n' +
    '  function isLearningRpgSfxSource(source){\n' +
    '    var src = String(source || "");\n' +
    '    return src.indexOf("Resources/Sounds/") !== -1 && src.indexOf("Resources/Sounds/BGM/") === -1;\n' +
    '  }\n' +
    '\n' +
    '  function isSoundEnabled(){\n' +
    '    try { return window.localStorage.getItem(SOUND_ENABLED_KEY) !== "0"; } catch (error) { return true; }\n' +
    '  }\n' +
    '\n' +
    '  function applySfxVolume(audio){\n' +
    '    if (!isAudioElement(audio)) return;\n' +
    '    if (audio.__learningRpgSkipSfxVolume) return;\n' +
    '    var src = String(audio.currentSrc || audio.src || "");\n' +
    '    if (!isLearningRpgSfxSource(src)) return;\n' +
    '    if (!isSoundEnabled()) {\n' +
    '      audio.muted = true;\n' +
    '      audio.volume = 0;\n' +
    '      return;\n' +
    '    }\n' +
    '    if (audio.__learningRpgSfxBaseVolume === undefined) {\n' +
    '      audio.__learningRpgSfxBaseVolume = Number(audio.volume || 1);\n' +
    '    }\n' +
    '    audio.volume = Math.max(0, Math.min(1, Number(audio.__learningRpgSfxBaseVolume || 1) * SFX_VOLUME_MULTIPLIER));\n' +
    '  }\n' +
    '\n' +
    '  function patchMediaPlayVolume(){\n' +
    '    if (!window.HTMLMediaElement || !HTMLMediaElement.prototype || HTMLMediaElement.prototype.__learningRpgSfxVolumePatched) return;\n' +
    '    var originalPlay = HTMLMediaElement.prototype.play;\n' +
    '    HTMLMediaElement.prototype.play = function(){\n' +
    '      applySfxVolume(this);\n' +
    '      return originalPlay.apply(this, arguments);\n' +
    '    };\n' +
    '    HTMLMediaElement.prototype.__learningRpgSfxVolumePatched = true;\n' +
    '  }\n' +
    '\n' +
    '  function stopRewardOneShot(){\n' +
    '    if (!rewardOneShotAudio) return;\n' +
    '    try {\n' +
    '      rewardOneShotAudio.pause();\n' +
    '      rewardOneShotAudio.currentTime = 0;\n' +
    '      rewardOneShotAudio.removeAttribute("src");\n' +
    '      rewardOneShotAudio.load();\n' +
    '    } catch (error) {}\n' +
    '    rewardOneShotAudio = null;\n' +
    '  }\n' +
    '\n' +
    '  function playRewardOneShot(){\n' +
    '    if (!isSoundEnabled()) return;\n' +
    '    if (Date.now() - lastRewardOneShotAt < 1200) return;\n' +
    '    lastRewardOneShotAt = Date.now();\n' +
    '    stopRewardOneShot();\n' +
    '    try {\n' +
    '      var audio = new Audio(assetUrl("Resources/Sounds/BGM/Battle/Reward.wav"));\n' +
    '      audio.loop = false;\n' +
    '      audio.preload = "auto";\n' +
    '      audio.volume = REWARD_ONE_SHOT_VOLUME;\n' +
    '      audio.muted = !isSoundEnabled();\n' +
    '      rewardOneShotAudio = audio;\n' +
    '      audio.addEventListener("ended", function(){\n' +
    '        if (rewardOneShotAudio === audio) {\n' +
    '          rewardOneShotAudio = null;\n' +
    '        }\n' +
    '      }, { once: true });\n' +
    '      var playPromise = audio.play();\n' +
    '      if (playPromise && playPromise.catch) {\n' +
    '        playPromise.catch(function(){});\n' +
    '      }\n' +
    '    } catch (error) {}\n' +
    '  }\n' +
    '\n' +
    '  function stopLoopingRewardBgmAndPlayOneShot(){\n' +
    '    window.setTimeout(function(){\n' +
    '      try {\n' +
    '        if (window.LEARNING_RPG_AUDIO && window.LEARNING_RPG_AUDIO.getCurrent) {\n' +
    '          var current = window.LEARNING_RPG_AUDIO.getCurrent();\n' +
    '          if (current && current.kind === "reward") {\n' +
    '            window.LEARNING_RPG_AUDIO.stop(180);\n' +
    '          }\n' +
    '        }\n' +
    '      } catch (error) {}\n' +
    '      playRewardOneShot();\n' +
    '    }, 120);\n' +
    '  }\n' +
    '\n' +
    '  function applySoundPreference(){\n' +
    '    if (!isSoundEnabled()) {\n' +
    '      stopRewardOneShot();\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  function patchFunction(name, wrapper){\n' +
    '    var attempts = 0;\n' +
    '    var timer = window.setInterval(function(){\n' +
    '      attempts += 1;\n' +
    '      var original = window[name];\n' +
    '      if (typeof original === "function" && !original.__learningRpgAudioTweaksPatched) {\n' +
    '        var patched = wrapper(original);\n' +
    '        patched.__learningRpgAudioTweaksPatched = true;\n' +
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
    '  function installRewardOneShotPatch(){\n' +
    '    patchFunction("renderRewardChoices", function(original){\n' +
    '      return function(){\n' +
    '        var result = original.apply(this, arguments);\n' +
    '        stopLoopingRewardBgmAndPlayOneShot();\n' +
    '        return result;\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("startBattleEntrance", function(original){\n' +
    '      return function(){\n' +
    '        stopRewardOneShot();\n' +
    '        return original.apply(this, arguments);\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("goHome", function(original){\n' +
    '      return function(){\n' +
    '        stopRewardOneShot();\n' +
    '        return original.apply(this, arguments);\n' +
    '      };\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  function install(){\n' +
    '    if (window.__learningRpgAudioVolumeTweaksInstalled) return;\n' +
    '    window.__learningRpgAudioVolumeTweaksInstalled = true;\n' +
    '    patchMediaPlayVolume();\n' +
    '    installRewardOneShotPatch();\n' +
    '    window.addEventListener("storage", function(event){ if (event.key === SOUND_ENABLED_KEY) applySoundPreference(); });\n' +
    '    window.addEventListener("learningRpgSoundPreferenceChanged", applySoundPreference);\n' +
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

function escapeAudioVolumeTweaksJsString_(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/<\//g, '<\\/');
}
