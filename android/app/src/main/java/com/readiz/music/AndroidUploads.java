package com.readiz.music;

import android.content.ActivityNotFoundException;
import android.content.pm.ProviderInfo;
import android.net.Uri;
import android.os.Process;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

/** System document picker grants access only to the file the user selects. */
final class AndroidUploads extends WebChromeClient {
    private final ComponentActivity host;
    private final WebView webView;
    private final ActivityResultLauncher<String[]> picker;
    private ValueCallback<Uri[]> pending;

    AndroidUploads(ComponentActivity host, WebView webView) {
        this.host = host;
        this.webView = webView;
        picker = host.registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::selected);
    }

    static boolean trusted(String url) {
        Uri uri = Uri.parse(url == null ? "" : url);
        return "https".equals(uri.getScheme()) && "music.readiz.com".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (!trusted(view.getUrl()) || params.getMode() != FileChooserParams.MODE_OPEN) return false;
        close();
        pending = callback;
        try { picker.launch(new String[] { "audio/*", "video/mp4", "video/webm", "application/ogg" }); }
        catch (ActivityNotFoundException unavailable) { close(); }
        return true;
    }

    void selected(Uri uri) {
        ValueCallback<Uri[]> callback = pending;
        pending = null;
        if (callback == null) return;
        boolean allowed = uri != null && "content".equals(uri.getScheme()) && trusted(webView.getUrl());
        // Do not accept a picker response pointing into the app's own private provider.
        if (allowed) {
            ProviderInfo provider = host.getPackageManager().resolveContentProvider(uri.getAuthority(), 0);
            allowed = provider != null && provider.applicationInfo != null && provider.applicationInfo.uid != Process.myUid();
        }
        callback.onReceiveValue(allowed ? new Uri[] { uri } : null);
    }

    void close() {
        if (pending != null) { pending.onReceiveValue(null); pending = null; }
    }
}
