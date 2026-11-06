(() => {
  const apiRequest = async (path, body, method) => {
    const response = await fetch(path, {
      method: method || (body ? "POST" : "GET"),
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Request failed.");
    return result;
  };

  const initializeLoginPage = () => {
    const loginForm = document.querySelector("#login-form");
    const signupForm = document.querySelector("#signup-form");
    const status = document.querySelector("#auth-status");
    const sessionPanel = document.querySelector("#auth-session");
    const loginPanel = document.querySelector("#login-panel");
    const signupPanel = document.querySelector("#signup-panel");
    const authCard = document.querySelector("#auth-card");
    if (!loginForm || !signupForm || !status || !sessionPanel || !loginPanel || !signupPanel || !authCard) return;

    const setStatus = (message, isError = false) => {
      status.textContent = message;
      status.classList.toggle("auth-status-error", isError);
      status.hidden = !message;
    };
    const showLogin = () => {
      signupPanel.hidden = true;
      loginPanel.hidden = false;
      authCard.querySelector("h2").textContent = "USER LOGIN";
      setStatus("");
    };
    const showSignup = () => {
      loginPanel.hidden = true;
      signupPanel.hidden = false;
      authCard.querySelector("h2").textContent = "CREATE ACCOUNT";
      setStatus("");
    };
    const showSession = (account) => {
      loginPanel.hidden = true;
      signupPanel.hidden = true;
      sessionPanel.hidden = false;
      sessionPanel.querySelector("[data-auth-username]").textContent = account.username;
      sessionPanel.querySelector("[data-auth-role]").textContent = account.is_admin ? "ADMIN" : "USER";
      setStatus(`SIGNED IN AS ${account.username.toUpperCase()}.`);
    };

    document.querySelector("#show-signup")?.addEventListener("click", showSignup);
    document.querySelector("#show-login")?.addEventListener("click", showLogin);
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("");
      const formData = new FormData(loginForm);
      try {
        const account = await apiRequest("/api/login", {
          identifier: String(formData.get("identifier") || "").trim(),
          password: String(formData.get("password") || "")
        });
        loginForm.reset();
        showSession(account);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not complete login.", true);
      }
    });
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("");
      const formData = new FormData(signupForm);
      const username = String(formData.get("username") || "").trim();
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const password = String(formData.get("password") || "");
      const confirmation = String(formData.get("confirm-password") || "");
      if (password !== confirmation) {
        setStatus("PASSWORDS DO NOT MATCH.", true);
        return;
      }
      try {
        const account = await apiRequest("/api/signup", { username, email, password });
        signupForm.reset();
        showSession(account);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not create the account.", true);
      }
    });
    sessionPanel.querySelector("#logout-button")?.addEventListener("click", async () => {
      try {
        await apiRequest("/api/logout", {});
        sessionPanel.hidden = true;
        loginForm.reset();
        showLogin();
        setStatus("SIGNED OUT.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not sign out.", true);
      }
    });

    apiRequest("/api/session").then((result) => {
      if (result.account) showSession(result.account);
    }).catch(() => {});
  };

  initializeLoginPage();

  const initializeNavSession = async () => {
    try {
      const result = await apiRequest("/api/session");
      if (!result.account) return;
      const loginLink = document.querySelector('.nav-links a[href="login.html"]');
      if (loginLink) loginLink.textContent = result.account.username.toUpperCase();
      if (result.account.is_admin && !document.querySelector('.nav-links a[href="admin.html"]')) {
        const item = document.createElement("li");
        item.innerHTML = '<a href="admin.html">Admin</a>';
        document.querySelector(".nav-links")?.append(item);
      }
    } catch {

    }
  };

  const initializeUpload = () => {
    const form = document.querySelector("#upload-form");
    if (!form) return;
    const status = document.querySelector("#upload-status");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const payload = {
        title: String(formData.get("video_title") || document.querySelector("#video-title")?.value || "").trim(),
        youtube_url: String(document.querySelector("#youtube-link")?.value || "").trim(),
        game: String(document.querySelector("#game")?.value || "").trim(),
        player1: String(document.querySelector("#player1-name")?.value || "").trim(),
        player2: String(document.querySelector("#player2-name")?.value || "").trim(),
        player1_char: String(document.querySelector("#player1-char")?.value || "").trim(),
        player2_char: String(document.querySelector("#player2-char")?.value || "").trim()
      };
      status.hidden = false;
      status.textContent = "SENDING REPLAY...";
      status.classList.remove("auth-status-error");
      try {
        await apiRequest("/api/replays", payload);
        status.textContent = "SUBMITTED FOR ADMIN REVIEW.";
        form.reset();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Could not submit replay.";
        status.classList.add("auth-status-error");
      }
    });
  };

  const loadPublishedReplays = async () => {
    const replayList = document.querySelector(".replay-list");
    if (!replayList) return;
    try {
      const { replays } = await apiRequest("/api/replays");
      if (!replays.length) return;
      replayList.querySelectorAll(".replay-card.dynamic-replay").forEach((card) => card.remove());
      replays.forEach((replay) => {
        const card = document.createElement("article");
        card.className = "metal-card replay-card dynamic-replay";
        card.dataset.game = replay.game;
        card.dataset.date = replay.submitted_at.slice(0, 10);
        card.dataset.videoId = replay.video_id;
        card.dataset.youtubeUrl = replay.youtube_url;
        card.dataset.title = replay.title;
        card.dataset.player1 = replay.player1;
        card.dataset.player2 = replay.player2;
        card.dataset.player1Char = replay.player1_char;
        card.dataset.player2Char = replay.player2_char;
        card.dataset.submittedAt = replay.submitted_at;
        card.innerHTML = `<div class="replay-summary"><div><span class="replay-game"></span><h3></h3><p></p></div><div class="replay-actions"><button type="button" class="text-link replay-play">PLAY REPLAY</button><a class="text-link replay-youtube" target="_blank" rel="noopener noreferrer">WATCH ON YOUTUBE</a><span class="replay-status">PUBLISHED</span></div></div>`;
        card.querySelector(".replay-youtube").href = replay.youtube_url;
        card.querySelector(".replay-game").textContent = replay.game.toUpperCase();
        card.querySelector("h3").textContent = replay.title.toUpperCase();
        card.querySelector("p").textContent = `${replay.player1} (${replay.player1_char}) vs ${replay.player2} (${replay.player2_char})`;
        replayList.append(card);
      });
      const applyDynamicFilters = () => {
        const queryInput = document.querySelector("#archive-search") || document.querySelector('input[name="q"]');
        const gameInput = document.querySelector("#game-filter");
        const query = (queryInput?.value || "").trim().toLocaleLowerCase();
        const game = (gameInput?.value || "").trim().toLocaleLowerCase();
        replayList.querySelectorAll(".dynamic-replay").forEach((card) => {
          card.hidden = !(card.textContent.toLocaleLowerCase().includes(query) && (!game || card.dataset.game.toLocaleLowerCase() === game));
        });
      };
      document.querySelectorAll('#archive-search, input[name="q"], #game-filter').forEach((input) => {
        input.addEventListener("input", applyDynamicFilters);
        input.addEventListener("change", applyDynamicFilters);
      });
      applyDynamicFilters();
    } catch {
      // Static sample cards remain available if the replay API is unreachable.
    }
  };

  const initializePlayer = () => {
    document.addEventListener("click", async (event) => {
      const button = event.target.closest(".replay-play, .video-preview .cyber-btn");
      if (!button) return;
      const card = button.closest(".replay-card, .grid-layout article");
      const videoId = card?.dataset.videoId;
      if (!videoId) return;

      const preview = document.querySelector(".video-preview");
      const featuredHeading = document.querySelector(".grid-layout .card-header h1") || document.querySelector(".grid-layout .card-header h2");
      const stats = document.querySelectorAll(".stats-list .stat-val");
      const submittedDate = card.dataset.submittedAt ? new Date(card.dataset.submittedAt) : null;
      const formattedDate = submittedDate && !Number.isNaN(submittedDate.valueOf())
        ? submittedDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" })
        : card.dataset.date || "";

      if (featuredHeading) featuredHeading.textContent = card.dataset.title || "REPLAY";
      if (stats.length >= 4) {
        stats[0].textContent = (card.dataset.player1 || "").toUpperCase();
        stats[1].textContent = (card.dataset.player2 || "").toUpperCase();
        stats[2].textContent = card.dataset.game || "";
        stats[3].textContent = formattedDate.toUpperCase();
      }

      document.querySelectorAll("#replay-details .details-grid > div").forEach((item) => {
        const label = item.querySelector("dt")?.textContent.trim().toUpperCase();
        const value = item.querySelector("dd");
        if (!value) return;
        if (label === "GAME") value.textContent = card.dataset.game || "";
        if (label === "DATE") value.textContent = formattedDate;
        if (label === "PLAYER 1") value.textContent = `${card.dataset.player1 || ""} · ${card.dataset.player1Char || ""}`;
        if (label === "PLAYER 2") value.textContent = `${card.dataset.player2 || ""} · ${card.dataset.player2Char || ""}`;
      });

      if (preview) {
        const playerUrl = new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`);
        playerUrl.searchParams.set("rel", "0");
        playerUrl.searchParams.set("playsinline", "1");
        playerUrl.searchParams.set("rel", "0");
        playerUrl.searchParams.set("playsinline", "1");
        preview.innerHTML = `<iframe title="YouTube replay player" src="${playerUrl.href}" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;height:100%;border:0"></iframe>`;
      }

    });
  };

  const initializeAdmin = () => {
    const list = document.querySelector("#admin-list");
    if (!list) return;
    const status = document.querySelector("#admin-status");
    const count = document.querySelector("#admin-count");
    const action = async (payload, message) => {
      try {
        await apiRequest("/api/admin/replays/action", payload);
        status.textContent = message;
        status.classList.remove("auth-status-error");
        await render();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Could not update replay.";
        status.classList.add("auth-status-error");
      }
    };
    const render = async () => {
      try {
        const { replays } = await apiRequest("/api/admin/replays");
        const pendingCount = replays.filter((replay) => replay.status === "pending").length;
        count.textContent = `${replays.length.toString().padStart(2, "0")} TOTAL · ${pendingCount.toString().padStart(2, "0")} PENDING`;
        list.replaceChildren();
        replays.forEach((replay) => {
          const card = document.createElement("article");
          card.className = "metal-card replay-card admin-card";
          card.innerHTML = `<div class="form-grid"><div class="form-group"><label>VIDEO TITLE</label><input class="cyber-input admin-title"></div><div class="form-group"><label>YOUTUBE LINK</label><input type="url" class="cyber-input admin-url"></div><div class="form-group"><label>GAME</label><input class="cyber-input admin-game"></div><div class="form-group"><label>PLAYER 1</label><input class="cyber-input admin-player1"></div><div class="form-group"><label>PLAYER 1 CHARACTER</label><input class="cyber-input admin-player1-char"></div><div class="form-group"><label>PLAYER 2</label><input class="cyber-input admin-player2"></div><div class="form-group"><label>PLAYER 2 CHARACTER</label><input class="cyber-input admin-player2-char"></div></div><p class="review-notice admin-submitter"></p><a class="text-link admin-link" target="_blank" rel="noopener noreferrer">OPEN YOUTUBE LINK</a><div class="replay-actions admin-actions"><span class="replay-status admin-status-label"></span><button type="button" class="cyber-btn admin-save">UPDATE</button><button type="button" class="cyber-btn admin-approve">APPROVE</button><button type="button" class="cyber-btn admin-reject">REJECT</button><button type="button" class="cyber-btn admin-delete">DELETE</button></div>`;
          card.querySelector(".admin-title").value = replay.title;
          card.querySelector(".admin-url").value = replay.youtube_url;
          card.querySelector(".admin-game").value = replay.game;
          card.querySelector(".admin-player1").value = replay.player1;
          card.querySelector(".admin-player1-char").value = replay.player1_char || "";
          card.querySelector(".admin-player2").value = replay.player2;
          card.querySelector(".admin-player2-char").value = replay.player2_char || "";
          card.querySelector(".admin-status-label").textContent = replay.status.toUpperCase();
          card.querySelector(".admin-submitter").textContent = `SUBMITTED BY: ${replay.submitted_by} · ${new Date(replay.submitted_at).toLocaleString()}`;
          card.querySelector(".admin-link").href = replay.youtube_url;
          card.querySelector(".admin-save").addEventListener("click", () => action({ id: replay.id, action: "edit", title: card.querySelector(".admin-title").value, youtube_url: card.querySelector(".admin-url").value, game: card.querySelector(".admin-game").value, player1: card.querySelector(".admin-player1").value, player1_char: card.querySelector(".admin-player1-char").value, player2: card.querySelector(".admin-player2").value, player2_char: card.querySelector(".admin-player2-char").value }, "REPLAY UPDATED."));
          card.querySelector(".admin-approve").addEventListener("click", () => action({ id: replay.id, action: "approve" }, "REPLAY APPROVED AND PUBLISHED."));
          card.querySelector(".admin-reject").addEventListener("click", () => action({ id: replay.id, action: "reject" }, "REPLAY REJECTED."));
          card.querySelector(".admin-delete").addEventListener("click", () => {
            if (window.confirm("Delete this replay permanently? This cannot be undone.")) {
              action({ id: replay.id, action: "delete" }, "REPLAY DELETED.");
            }
          });
          list.append(card);
        });
        if (!replays.length) list.innerHTML = '<p class="archive-empty-state">NO REPLAY RECORDS.</p>';
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Administrator access required.";
        status.classList.add("auth-status-error");
      }
    };
    render();
  };

  const initializeArchive = () => {
  const archive = document.querySelector("#replay-archive");
  if (!archive) {
    return;
  }

  const filterForm = archive.querySelector(".archive-controls");
  const replayList = archive.querySelector(".replay-list");
  const searchInputs = Array.from(document.querySelectorAll('input[name="q"]'));
  const archiveSearch = archive.querySelector("#archive-search");
  const gameFilter = archive.querySelector("#game-filter");
  const sortSelect = archive.querySelector("#sort-replays");
  const count = document.querySelector("#archive-count");

  if (!filterForm || !replayList || !archiveSearch || !gameFilter || !sortSelect) {
    return;
  }

  const replayCards = Array.from(replayList.querySelectorAll(".replay-card"));
  const emptyMessage = document.createElement("p");
  emptyMessage.className = "archive-empty-state";
  emptyMessage.setAttribute("role", "status");
  emptyMessage.textContent = "NO MATCHES FOUND. TRY A DIFFERENT SEARCH OR FILTER.";

  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get("q") || "";
  archiveSearch.value = initialQuery;
  searchInputs.forEach((input) => {
    input.value = initialQuery;
  });
  gameFilter.value = params.get("game") || "";
  sortSelect.value = params.get("sort") || "newest";

  const updateUrl = () => {
    const url = new URL(window.location.href);
    const query = archiveSearch.value.trim();

    if (query) {
      url.searchParams.set("q", query);
    } else {
      url.searchParams.delete("q");
    }

    if (gameFilter.value) {
      url.searchParams.set("game", gameFilter.value);
    } else {
      url.searchParams.delete("game");
    }

    if (sortSelect.value === "newest") {
      url.searchParams.delete("sort");
    } else {
      url.searchParams.set("sort", sortSelect.value);
    }

    window.history.replaceState(null, "", url);
  };

  const applyFilters = () => {
    const query = archiveSearch.value.trim().toLocaleLowerCase();
    const selectedGame = gameFilter.value.toLocaleLowerCase();
    const sortBy = sortSelect.value;

    const sortedCards = replayCards.slice().sort((first, second) => {
      if (sortBy === "game") {
        return first.dataset.game.localeCompare(second.dataset.game);
      }

      const dateDifference = Date.parse(first.dataset.date) - Date.parse(second.dataset.date);
      return sortBy === "oldest" ? dateDifference : -dateDifference;
    });

    let visibleCount = 0;
    sortedCards.forEach((card) => {
      const matchesSearch = card.textContent.toLocaleLowerCase().includes(query);
      const matchesGame = !selectedGame || card.dataset.game.toLocaleLowerCase() === selectedGame;
      card.hidden = !matchesSearch || !matchesGame;
      if (!card.hidden) {
        visibleCount += 1;
      }
      replayList.append(card);
    });

    emptyMessage.hidden = visibleCount > 0;
    replayList.append(emptyMessage);

    if (count) {
      count.textContent = `${visibleCount.toString().padStart(2, "0")} MATCH${visibleCount === 1 ? "" : "ES"}`;
    }

    updateUrl();
  };

  searchInputs.forEach((input) => {
    input.addEventListener("input", () => {
      archiveSearch.value = input.value;
      searchInputs.forEach((otherInput) => {
        if (otherInput !== input) {
          otherInput.value = input.value;
        }
      });
      applyFilters();
    });
  });

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters();
  });

  document.querySelector(".navbar .search-container")?.addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters();
    archive.scrollIntoView({ behavior: "smooth" });
  });

  gameFilter.addEventListener("change", applyFilters);
  sortSelect.addEventListener("change", applyFilters);

  applyFilters();
  };

  initializeNavSession();
  initializeUpload();
  loadPublishedReplays();
  initializePlayer();
  initializeAdmin();
  initializeArchive();

  const initializeContact = () => {
    const form = document.querySelector("#contact-form");
    const status = document.querySelector("#contact-status");
    if (!form || !status) return;

    const setStatus = (message, isError = false) => {
      status.textContent = message;
      status.classList.toggle("form-status-error", isError);
      status.hidden = !message;
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const formData = new FormData(form);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        subject: String(formData.get("subject") || "").trim(),
        message: String(formData.get("message") || "").trim()
      };

      button.disabled = true;
      setStatus("SENDING TRANSMISSION...");
      try {
        await apiRequest("/api/contact", payload);
        form.reset();
        setStatus("MESSAGE SENT SUCCESSFULLY.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not send the message.", true);
      } finally {
        button.disabled = false;
      }
    });
  };

  initializeContact();

  const initializeAuth = () => {
    const loginForm = document.querySelector("#login-form");
    const signupForm = document.querySelector("#signup-form");
    const authStatus = document.querySelector("#auth-status");
    const authSession = document.querySelector("#auth-session");
    const loginPanel = document.querySelector("#login-panel");
    const signupPanel = document.querySelector("#signup-panel");
    const authCard = document.querySelector("#auth-card");

    if (!loginForm || !signupForm || !authStatus || !authSession || !authCard) {
      return;
    }

    const setStatus = (message, isError = false) => {
      authStatus.textContent = message;
      authStatus.classList.toggle("auth-status-error", isError);
      authStatus.hidden = !message;
    };

    const request = async (path, body) => {
      let response;
      try {
        response = await fetch(path, {
          method: body ? "POST" : "GET",
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
          credentials: "same-origin"
        });
      } catch {
        throw new Error("Could not reach the local auth server. Start it with python server.py.");
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The local auth server returned an invalid response.");
      }

      if (!response.ok) {
        throw new Error(result.error || "The auth request failed.");
      }
      return result;
    };

    const setSignedIn = (account) => {
      loginPanel.hidden = true;
      signupPanel.hidden = true;
      authSession.hidden = false;
      authSession.querySelector("[data-auth-username]").textContent = account.username;
      authSession.querySelector("[data-auth-role]").textContent = account.is_admin ? "ADMIN" : "USER";
      setStatus(`SIGNED IN AS ${account.username.toUpperCase()}.`);
    };

    const showLogin = () => {
      signupPanel.hidden = true;
      loginPanel.hidden = false;
      authCard.querySelector("h2").textContent = "USER LOGIN";
      setStatus("");
    };

    const showSignup = () => {
      loginPanel.hidden = true;
      signupPanel.hidden = false;
      authCard.querySelector("h2").textContent = "CREATE ACCOUNT";
      setStatus("");
    };

    const setSignedOut = (message = "") => {
      authSession.hidden = true;
      loginForm.reset();
      showLogin();
      setStatus(message);
    };

    document.querySelector("#show-signup")?.addEventListener("click", showSignup);
    document.querySelector("#show-login")?.addEventListener("click", showLogin);

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("");

      const formData = new FormData(loginForm);
      const identifier = String(formData.get("identifier")).trim();
      const password = String(formData.get("password"));

      try {
        const account = await request("/api/login", { identifier, password });
        setSignedIn(account);
        loginForm.reset();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not complete login.", true);
      }
    });

    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("");

      const formData = new FormData(signupForm);
      const username = String(formData.get("username")).trim();
      const email = String(formData.get("email")).trim().toLocaleLowerCase();
      const password = String(formData.get("password"));
      const confirmation = String(formData.get("confirm-password"));

      if (password !== confirmation) {
        setStatus("PASSWORDS DO NOT MATCH.", true);
        return;
      }

      try {
        const account = await request("/api/signup", { username, email, password });
        signupForm.reset();
        setSignedIn(account);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not create the account.", true);
      }
    });

    authSession.querySelector("#logout-button")?.addEventListener("click", () => {
      request("/api/logout", {}).then(() => setSignedOut("SIGNED OUT.")).catch((error) => {
        setStatus(error instanceof Error ? error.message : "Could not sign out.", true);
      });
    });

    request("/api/session").then((result) => {
      if (result.account) {
        setSignedIn(result.account);
      }
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Could not restore the session.", true);
    });
  };

})();