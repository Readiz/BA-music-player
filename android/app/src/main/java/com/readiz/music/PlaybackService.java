package com.readiz.music;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionResult;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.List;

/** Owns playback and queue progression even when no WebView exists. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class PlaybackService extends MediaSessionService {
    static final String OPTIONS = "com.readiz.music.OPTIONS";
    private static PlaybackService active;
    private final Handler checkpointHandler = new Handler(Looper.getMainLooper());
    private final Runnable checkpoint = new Runnable() {
        @Override public void run() {
            saveSnapshot();
            if (player != null && player.getPlayWhenReady()) checkpointHandler.postDelayed(this, 15000);
        }
    };
    static Player widgetPlayer() { return active == null ? null : active.player; }
    private void saveSnapshot() {
        if (player != null && session != null) PlaybackSnapshot.save(this, player, session.getSessionExtras());
    }
    private ExoPlayer player;
    private MediaSession session;
    @Override public void onCreate() {
        super.onCreate();
        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_LOCAL);
        player.setRepeatMode(Player.REPEAT_MODE_ALL);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        session = new MediaSession.Builder(this, player)
                .setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setCallback(new MediaSession.Callback() {
                    @Override public MediaSession.ConnectionResult onConnect(MediaSession s, MediaSession.ControllerInfo controller) {
                        if (!getPackageName().equals(controller.getPackageName()) && !controller.isTrusted()
                                && !s.isMediaNotificationController(controller)) return MediaSession.ConnectionResult.reject();
                        var commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon();
                        if (getPackageName().equals(controller.getPackageName())) commands.add(new SessionCommand(OPTIONS, Bundle.EMPTY));
                        return new MediaSession.ConnectionResult.AcceptedResultBuilder(s)
                                .setAvailableSessionCommands(commands.build()).build();
                    }
                    @Override public ListenableFuture<SessionResult> onCustomCommand(MediaSession s, MediaSession.ControllerInfo controller,
                            SessionCommand command, Bundle args) {
                        if (!OPTIONS.equals(command.customAction) || !getPackageName().equals(controller.getPackageName()))
                            return Futures.immediateFuture(new SessionResult(androidx.media3.session.SessionError.ERROR_NOT_SUPPORTED));
                        boolean repeat = args.getBoolean("repeat", false);
                        player.setRepeatMode(repeat ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_ALL);
                        player.setPauseAtEndOfMediaItems(!repeat && !args.getBoolean("autoNext", true));
                        s.setSessionExtras(new Bundle(args));
                        saveSnapshot();
                        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                    }
                    @Override public ListenableFuture<List<MediaItem>> onAddMediaItems(MediaSession s, MediaSession.ControllerInfo controller,
                            List<MediaItem> items) {
                        for (MediaItem item : items) {
                            if (item.localConfiguration == null || !PlaybackBridge.mediaUrl(item.localConfiguration.uri))
                                return Futures.immediateFailedFuture(new IllegalArgumentException("Untrusted media"));
                        }
                        return Futures.immediateFuture(items);
                    }
                }).build();
        PlaybackSnapshot saved = PlaybackSnapshot.load(this);
        if (!saved.items.isEmpty()) {
            player.setMediaItems(saved.items, saved.index, saved.position);
            player.setRepeatMode(saved.options.getBoolean("repeat") ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_ALL);
            player.setPauseAtEndOfMediaItems(!saved.options.getBoolean("repeat") && !saved.options.getBoolean("autoNext", true));
            session.setSessionExtras(saved.options);
        }
        active = this;
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player source, Player.Events events) {
                saveSnapshot();
                MusicWidget.updateAll(PlaybackService.this);
                checkpointHandler.removeCallbacks(checkpoint);
                if (player.getPlayWhenReady()) checkpointHandler.postDelayed(checkpoint, 15000);
            }
        });
        MusicWidget.updateAll(this);
    }
    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }
    @Override public void onTaskRemoved(Intent rootIntent) {
        saveSnapshot();
        if (!isPlaybackOngoing()) stopSelf();
    }
    @Override public void onDestroy() {
        saveSnapshot();
        checkpointHandler.removeCallbacksAndMessages(null);
        active = null;
        MusicWidget.updateAll(this);
        if (session != null) session.release();
        if (player != null) player.release();
        super.onDestroy();
    }
}
