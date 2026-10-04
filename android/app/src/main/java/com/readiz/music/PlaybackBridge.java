package com.readiz.music;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionToken;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.ArrayList;
import java.util.Collections;
import org.json.JSONArray;
import org.json.JSONObject;

/** Main-frame, fixed-origin message port; no Java objects exposed to other pages. */
final class PlaybackBridge {
    private final WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ListenableFuture<MediaController> future;
    private MediaController controller;
    private JavaScriptReplyProxy reply;
    private boolean closed;
    private final Runnable tick = new Runnable() {
        @Override public void run() { publish(false); if (!closed) handler.postDelayed(this, 500); }
    };
    PlaybackBridge(MainActivity activity, WebView web) {
        this.web = web;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
            throw new IllegalStateException("Android System WebView 업데이트가 필요합니다.");
        WebViewCompat.addWebMessageListener(web, "ReadizMusicNative", Collections.singleton("https://music.readiz.com"),
            (view, message, origin, mainFrame, port) -> {
                if (!mainFrame || !trusted(origin) || !trusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return;
                reply = port;
                try {
                    String data = message.getData();
                    if (data == null || data.length() > 1_000_000) return;
                    command(new JSONObject(data));
                } catch (Exception ignored) { publishError(); }
            });
        future = new MediaController.Builder(activity, new SessionToken(activity, new ComponentName(activity, PlaybackService.class)))
                .setListener(new MediaController.Listener() {
                    @Override public void onExtrasChanged(MediaController c, Bundle extras) { publish(false); }
                    @Override public void onDisconnected(MediaController c) { controller = null; publishError(); }
                }).buildAsync();
        future.addListener(() -> {
            if (closed) return;
            try {
                controller = future.get();
                controller.addListener(new Player.Listener() {
                    @Override public void onEvents(Player p, Player.Events events) {
                        publish(events.contains(Player.EVENT_TIMELINE_CHANGED));
                    }
                });
                publish(true);
                handler.post(tick);
            } catch (Exception ignored) { publishError(); }
        }, ContextCompat.getMainExecutor(activity));
    }
    static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && "music.readiz.com".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }
    static boolean mediaUrl(Uri uri) {
        String path = uri.getPath();
        return trusted(uri) && path != null && path.startsWith("/music/") && !path.contains("/../")
                && uri.getQuery() == null && uri.getFragment() == null;
    }
    static ArrayList<MediaItem> parseQueue(JSONArray values) throws Exception {
        if (values.length() > 1000) throw new IllegalArgumentException("Queue too large");
        ArrayList<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            JSONObject value = values.getJSONObject(i);
            Uri uri = Uri.parse(value.getString("src"));
            if (!mediaUrl(uri)) throw new IllegalArgumentException("Untrusted media URL");
            MediaMetadata.Builder metadata = new MediaMetadata.Builder().setTitle(value.optString("title", "Readiz Music"))
                    .setArtist(value.optString("artist")).setAlbumTitle(value.optString("folder"));
            String artwork = value.optString("artwork");
            if (!artwork.isEmpty()) {
                Uri art = Uri.parse(artwork);
                if (trusted(art) && art.getPath() != null && art.getPath().startsWith("/assets/albums/")) metadata.setArtworkUri(art);
            }
            items.add(new MediaItem.Builder().setMediaId(value.getString("id")).setUri(uri).setMediaMetadata(metadata.build()).build());
        }
        return items;
    }
    private void command(JSONObject value) throws Exception {
        if (controller == null) return;
        switch (value.getString("type")) {
            case "sync": publish(true); return;
            case "queue": {
                var items = parseQueue(value.getJSONArray("tracks"));
                int index = value.optInt("index", 0);
                if (items.isEmpty()) { controller.pause(); controller.clearMediaItems(); break; }
                if (index < 0 || index >= items.size()) throw new IllegalArgumentException("Invalid index");
                long position = value.optBoolean("preserve") && controller.getCurrentMediaItem() != null
                        && controller.getCurrentMediaItem().mediaId.equals(items.get(index).mediaId) ? controller.getCurrentPosition() : 0;
                controller.setMediaItems(items, index, position);
                controller.prepare();
                controller.setPlayWhenReady(value.optBoolean("play"));
                break;
            }
            case "select": {
                int index = value.getInt("index");
                if (index < 0 || index >= controller.getMediaItemCount()) return;
                controller.seekTo(index, 0); controller.prepare();
                controller.setPlayWhenReady(value.optBoolean("play", true)); break;
            }
            case "play":
                if (controller.getPlaybackState() == Player.STATE_ENDED) controller.seekToDefaultPosition();
                controller.prepare(); controller.play(); break;
            case "pause": controller.pause(); break;
            case "seek": controller.seekTo(Math.max(0, value.getLong("position"))); break;
            case "next": controller.seekToNextMediaItem(); controller.play(); break;
            case "previous": controller.seekToPreviousMediaItem(); controller.play(); break;
            case "options": {
                Bundle args = new Bundle();
                args.putBoolean("repeat", value.optBoolean("repeat"));
                args.putBoolean("autoNext", value.optBoolean("autoNext", true));
                args.putBoolean("random", value.optBoolean("random", true));
                controller.sendCustomCommand(new SessionCommand(PlaybackService.OPTIONS, Bundle.EMPTY), args); break;
            }
            case "stop": controller.pause(); controller.clearMediaItems(); break;
            default: return;
        }
        publish(false);
    }
    private void publish(boolean includeQueue) {
        if (closed || reply == null || controller == null) return;
        try {
            MediaItem item = controller.getCurrentMediaItem();
            Bundle options = controller.getSessionExtras();
            JSONObject state = new JSONObject().put("type", "state").put("id", item == null ? "" : item.mediaId)
                    .put("position", controller.getCurrentPosition() / 1000.0)
                    .put("duration", controller.getDuration() == C.TIME_UNSET ? 0 : controller.getDuration() / 1000.0)
                    .put("paused", !controller.getPlayWhenReady()).put("ended", controller.getPlaybackState() == Player.STATE_ENDED)
                    .put("buffering", controller.getPlaybackState() == Player.STATE_BUFFERING)
                    .put("error", controller.getPlayerError() != null)
                    .put("repeat", controller.getRepeatMode() == Player.REPEAT_MODE_ONE)
                    .put("autoNext", options.getBoolean("autoNext", true)).put("random", options.getBoolean("random", true));
            if (includeQueue) {
                JSONArray ids = new JSONArray();
                for (int i = 0; i < controller.getMediaItemCount(); i++) ids.put(controller.getMediaItemAt(i).mediaId);
                state.put("queue", ids);
            }
            reply.postMessage(state.toString());
        } catch (Exception ignored) { /* A navigation can invalidate the old message port. */ }
    }
    private void publishError() {
        if (!closed && reply != null) try { reply.postMessage("{\"type\":\"failure\"}"); } catch (Exception ignored) { }
    }
    boolean busy() { return controller != null && controller.getPlayWhenReady() && controller.getMediaItemCount() > 0; }
    void stop() { if (controller != null) { controller.pause(); controller.clearMediaItems(); } }
    void close() {
        closed = true; reply = null;
        handler.removeCallbacksAndMessages(null);
        WebViewCompat.removeWebMessageListener(web, "ReadizMusicNative");
        MediaController.releaseFuture(future);
    }
}
