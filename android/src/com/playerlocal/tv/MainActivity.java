package com.playerlocal.tv;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * App de TV do Player Local: encontra o servidor na rede (broadcast UDP, depois varredura HTTP)
 * e abre a interface web dele em tela cheia, repassando o botão Voltar do controle.
 */
public class MainActivity extends Activity {
    private static final int DISCOVERY_PORT = 8765;
    private static final int[] HTTP_PORTS = {8765, 8766, 8767};
    private static final String SETUP = "file:///android_asset/setup.html";

    private WebView web;
    private SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean searching = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // TV: sempre deitado. Celular: segue o aparelho (o player pede tela deitada via playerMode).
        setRequestedOrientation(isTv() ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        prefs = getSharedPreferences("player", MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0D12);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setAllowFileAccess(true);
        s.setUserAgentString(s.getUserAgentString() + " PlayerLocalApp/1.0");
        web.addJavascriptInterface(new Bridge(), "PlayerLocalApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame() && !req.getUrl().toString().startsWith("file:")) {
                    showSetup("notfound", "Não foi possível abrir " + req.getUrl().getHost() + ".", currentServer());
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public Bitmap getDefaultVideoPoster() { // evita o ícone cinza de "play" antes do vídeo carregar
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        setContentView(web);
        web.requestFocus();
        findServer();
    }

    private boolean isTv() {
        UiModeManager m = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        return m != null && m.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    /** Celular: no player, tela deitada (pelo sensor) e barras do sistema escondidas. */
    private final Runnable leavePlayer = () -> {
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        systemBars(true);
    };
    private void playerMode(boolean on) {
        if (isTv()) return;
        ui.removeCallbacks(leavePlayer);
        if (on) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            systemBars(false);
        } else {
            ui.postDelayed(leavePlayer, 600); // ao trocar de episódio o player sai e volta logo em seguida
        }
    }
    @SuppressWarnings("deprecation")
    private void systemBars(boolean show) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (show) c.show(WindowInsets.Type.navigationBars());
            else {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(show ? View.SYSTEM_UI_FLAG_FULLSCREEN
                : View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    private String currentServer() { return prefs.getString("url", ""); }

    private void showSetup(String state, String msg, String url) {
        final String target = SETUP + "#state=" + Uri.encode(state) + "&msg=" + Uri.encode(msg == null ? "" : msg)
                + "&url=" + Uri.encode(url == null ? "" : url);
        ui.post(() -> web.loadUrl(target));
    }

    private void openServer(String url) {
        prefs.edit().putString("url", url).apply();
        ui.post(() -> { web.clearHistory(); web.loadUrl(url + "/"); });
    }

    /** Procura o servidor: último endereço salvo → broadcast UDP → varredura da rede local. */
    private void findServer() {
        if (searching) return;
        searching = true;
        showSetup("searching", "", currentServer());
        new Thread(() -> {
            try {
                String saved = currentServer();
                if (!saved.isEmpty() && ping(saved)) { openServer(saved); return; }
                String found = discoverUdp();
                if (found == null) found = scanSubnet();
                if (found != null) openServer(found);
                else showSetup("notfound", "Servidor não encontrado na rede.", saved);
            } finally {
                searching = false;
            }
        }).start();
    }

    private static boolean ping(String base) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/api/home").openConnection();
            c.setConnectTimeout(1500);
            c.setReadTimeout(4000);
            if (c.getResponseCode() != 200) return false;
            InputStream in = c.getInputStream();
            byte[] buf = new byte[64];
            int n = in.read(buf);
            return n > 0 && new String(buf, 0, n, StandardCharsets.UTF_8).contains("continue");
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static List<InterfaceAddress> localIPv4() {
        List<InterfaceAddress> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses())
                    if (ia.getAddress() instanceof Inet4Address) out.add(ia);
            }
        } catch (Exception ignored) { }
        return out;
    }

    private String discoverUdp() {
        try (DatagramSocket sock = new DatagramSocket()) {
            sock.setBroadcast(true);
            sock.setSoTimeout(700);
            byte[] msg = "PLAYER_LOCAL_DISCOVER".getBytes(StandardCharsets.UTF_8);
            List<InetAddress> targets = new ArrayList<>();
            targets.add(InetAddress.getByName("255.255.255.255"));
            for (InterfaceAddress ia : localIPv4()) if (ia.getBroadcast() != null) targets.add(ia.getBroadcast());
            byte[] buf = new byte[1024];
            for (int attempt = 0; attempt < 3; attempt++) {
                for (InetAddress t : targets) sock.send(new DatagramPacket(msg, msg.length, t, DISCOVERY_PORT));
                long until = System.currentTimeMillis() + 900;
                while (System.currentTimeMillis() < until) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try { sock.receive(p); } catch (SocketTimeoutException e) { break; }
                    JSONObject j = new JSONObject(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                    if (!"player-local".equals(j.optString("app"))) continue;
                    String url = "http://" + p.getAddress().getHostAddress() + ":" + j.optInt("port", 8765);
                    if (ping(url)) return url;
                }
            }
        } catch (Exception ignored) { }
        return null;
    }

    private String scanSubnet() {
        List<InterfaceAddress> addrs = localIPv4();
        if (addrs.isEmpty()) return null;
        byte[] me = addrs.get(0).getAddress().getAddress();
        String prefix = (me[0] & 255) + "." + (me[1] & 255) + "." + (me[2] & 255) + ".";
        ExecutorService pool = Executors.newFixedThreadPool(48);
        AtomicReference<String> found = new AtomicReference<>();
        for (int port : HTTP_PORTS)
            for (int i = 1; i < 255; i++) {
                final String url = "http://" + prefix + i + ":" + port;
                pool.execute(() -> { if (found.get() == null && ping(url)) found.compareAndSet(null, url); });
            }
        pool.shutdown();
        try {
            long deadline = System.currentTimeMillis() + 25000;
            while (!pool.isTerminated() && found.get() == null && System.currentTimeMillis() < deadline)
                pool.awaitTermination(200, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) { }
        pool.shutdownNow();
        return found.get();
    }

    /** Chamado pela página de configuração (assets/setup.html). */
    private class Bridge {
        @JavascriptInterface
        public void retry() { findServer(); }

        @JavascriptInterface
        public void playerMode(boolean on) { ui.post(() -> MainActivity.this.playerMode(on)); }

        @JavascriptInterface
        public void connect(String input) {
            String v = input == null ? "" : input.trim();
            if (v.isEmpty()) return;
            if (!v.startsWith("http://") && !v.startsWith("https://")) v = "http://" + v;
            if (v.endsWith("/")) v = v.substring(0, v.length() - 1);
            if (Uri.parse(v).getPort() == -1) v = v + ":8765";
            final String url = v;
            showSetup("searching", "", url);
            new Thread(() -> {
                if (ping(url)) openServer(url);
                else showSetup("notfound", "Não houve resposta de " + url + ".", url);
            }).start();
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        boolean onSetup = web.getUrl() != null && web.getUrl().startsWith("file:");
        if (k == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                if (onSetup) {
                    if (!currentServer().isEmpty() && !searching) openServer(currentServer()); else finish();
                } else {
                    web.evaluateJavascript("(window.__appBack ? window.__appBack() : false)", r -> {
                        if (!"true".equals(r)) finish();
                    });
                }
            }
            return true;
        }
        // Tecla Menu (ou Configurações) abre a tela para trocar o servidor
        if ((k == KeyEvent.KEYCODE_MENU || k == KeyEvent.KEYCODE_SETTINGS) && !onSetup) {
            if (e.getAction() == KeyEvent.ACTION_UP) showSetup("manual", "", currentServer());
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    protected void onPause() {
        // pausa o vídeo (o que também salva o progresso no servidor)
        web.evaluateJavascript("document.querySelectorAll('video').forEach(function(v){v.pause()})", null);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
