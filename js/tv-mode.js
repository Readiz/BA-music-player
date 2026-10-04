window.BAMusicTV = /Tizen|SmartTV|Smart-TV|Web0S|WebOS|ReadizMusicTV|AndroidTV/i.test(navigator.userAgent) || new URLSearchParams(location.search).get("tv") === "1";
if (window.BAMusicTV) document.documentElement.classList.add("tv-layout");
