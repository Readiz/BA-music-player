(function(root) {
  root.BAMusicTrackSelection = function(tracks, saved) {
    const choices = /* @__PURE__ */ new Map();
    if (saved && saved.version === 1 && saved.albums && typeof saved.albums === "object") {
      for (const folder of new Set(tracks.map((track) => track.folder))) {
        if (Object.prototype.hasOwnProperty.call(saved.albums, folder) && Array.isArray(saved.albums[folder])) {
          const known = new Set(tracks.filter((track) => track.folder === folder).map((track) => track.src));
          choices.set(folder, new Set(saved.albums[folder].filter((id) => known.has(id))));
        }
      }
    }
    return {
      indices(albums) {
        const folders = new Set(albums);
        return tracks.reduce((result, track, index) => {
          if (folders.has(track.folder) && (!choices.has(track.folder) || choices.get(track.folder).has(track.src))) result.push(index);
          return result;
        }, []);
      },
      replace(albums, ids) {
        const selected = new Set(ids);
        for (const folder of albums) {
          const available = tracks.filter((track) => track.folder === folder).map((track) => track.src);
          const included = available.filter((id) => selected.has(id));
          if (included.length === available.length) choices.delete(folder);
          else choices.set(folder, new Set(included));
        }
      },
      include(index) {
        const track = tracks[index];
        if (track && choices.has(track.folder)) choices.get(track.folder).add(track.src);
      },
      serialize() {
        const albums = /* @__PURE__ */ Object.create(null);
        for (const [folder, ids] of choices) albums[folder] = [...ids];
        return { version: 1, albums };
      }
    };
  };
})(typeof window === "undefined" ? globalThis : window);
