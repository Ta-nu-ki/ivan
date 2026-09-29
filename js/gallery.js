/*
 * gallery.js — диагональная галерея на главной странице.
 *
 * Что здесь есть:
 *   1. Настройки (CONFIG)
 *   2. Безопасный мини-Markdown для описаний объектов
 *   3. Галерея: раскладка, плавное листание (колесо, свайп, стрелки)
 *   4. Окно объекта (модальное), с фокусом и закрытием по Esc
 *   5. Переход на другие страницы с анимацией
 *
 * Данные объектов лежат в data/objects.js (window.OBJECTS).
 * Скрипт обычный (не module), поэтому сайт работает и с GitHub Pages,
 * и при открытии index.html двойным кликом с диска.
 */
(function () {
    "use strict";

    /* ---------------------------------------------------------------
     * 1. Настройки
     * ------------------------------------------------------------- */
    const CONFIG = {
        visible: 5,        // сколько карточек помещается на диагонали
        total: 10,         // максимум карточек на странице
        aspect: 0.75,      // отношение ширины карточки к высоте
        padding: 20,       // отступ от краёв экрана, px
        smooth: 0.08,      // плавность обычного листания (0..1)
        exitSmooth: 0.22,  // плавность при уходе на другую страницу
        exitDelay: 700,    // пауза перед переходом (совпадает с fade в CSS), мс
        wheelStep: 150,    // сколько px колеса = один шаг
        touchStep: 120,    // сколько px свайпа = один шаг
        epsilon: 0.001     // порог, при котором анимация считается завершённой
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------------------------------------------------------------
     * 2. Мини-Markdown (без внешних библиотек)
     *    Поддерживает: абзацы, переносы строк, списки «- », заголовки «#»,
     *    **жирный**, *курсив*, [ссылки](https://...).
     *    Весь текст экранируется, так что HTML из описания не выполнится.
     * ------------------------------------------------------------- */
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function renderInline(text) {
        return escapeHtml(text)
            .replace(
                /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
            )
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    }

    function renderMarkdown(source) {
        return String(source || "")
            .replace(/\r\n?/g, "\n")
            .trim()
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((block) => {
                const lines = block.split("\n");

                if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
                    const items = lines
                        .map((line) => `<li>${renderInline(line.replace(/^\s*[-*]\s+/, ""))}</li>`)
                        .join("");
                    return `<ul>${items}</ul>`;
                }

                if (/^#{1,3}\s+/.test(block)) {
                    return `<h3>${renderInline(block.replace(/^#{1,3}\s+/, ""))}</h3>`;
                }

                return `<p>${lines.map(renderInline).join("<br>")}</p>`;
            })
            .join("");
    }

    /* ---------------------------------------------------------------
     * 3. Галерея
     * ------------------------------------------------------------- */
    const gallery = document.getElementById("gallery");
    const objects = (Array.isArray(window.OBJECTS) ? window.OBJECTS : [])
        .filter((item) => item && item.image)
        .slice(0, CONFIG.total);

    let images = [];
    let stepX = 0;
    let stepY = 0;

    let current = 0;             // текущее положение (плавно догоняет target)
    let target = 0;              // куда листаем
    let browseMax = Math.max(0, objects.length - 1);          // до куда листает пользователь
    let exitProgress = Math.max(CONFIG.total - CONFIG.visible, browseMax); // куда уезжает при уходе
    let isLeaving = false;

    let frameId = null;
    let onSettled = null;        // вызывается, когда анимация доехала до target

    function renderGallery() {
        gallery.textContent = "";

        objects.forEach((object, index) => {
            const img = document.createElement("img");

            img.className = "image";
            img.src = object.image;
            img.alt = object.alt || object.title || `Объект ${index + 1}`;
            img.dataset.index = String(index);
            img.loading = index < CONFIG.visible ? "eager" : "lazy";
            img.decoding = "async";
            img.tabIndex = 0;
            img.setAttribute("role", "button");

            img.addEventListener("click", (event) => {
                event.stopPropagation();
                openModal(index);
            });

            img.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openModal(index);
                }
            });

            gallery.appendChild(img);
        });

        images = Array.from(gallery.querySelectorAll(".image"));
    }

    function layout() {
        if (!images.length) {
            return;
        }

        const W = window.innerWidth;
        const H = window.innerHeight;
        const compact = W < 700;
        const pad = CONFIG.padding;

        /* Размер карточки */
        let height = Math.min(H * 0.4, 600);
        let width = height * CONFIG.aspect;

        width = Math.min(width, W * (compact ? 0.5 : 0.36));
        height = width / CONFIG.aspect;

        if (height > H * 0.5) {
            height = H * 0.5;
            width = height * CONFIG.aspect;
        }

        gallery.style.setProperty("--image-width", `${width}px`);
        gallery.style.setProperty("--image-height", `${height}px`);

        /* Защитная зона под логотипом */
        const logoWidth = Math.min(180, W * 0.16);
        const safeLeft = compact ? pad : logoWidth + 70;
        const safeTop = logoWidth * 0.35 + 70;

        const startX = Math.max(pad, safeLeft);
        const startY = Math.max(pad, safeTop);
        const endX = W - width - pad;
        const endY = H - height - pad;

        stepX = Math.max((endX - startX) / (CONFIG.visible - 1), 1);
        stepY = Math.max((endY - startY) / (CONFIG.visible - 1), 1);

        images.forEach((image, index) => {
            image.style.left = `${startX + stepX * index}px`;
            image.style.top = `${startY + stepY * index}px`;
        });

        target = clamp(target, 0, exitProgress);
        current = clamp(current, 0, exitProgress);
        paint();
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(value, max));
    }

    function paint() {
        gallery.style.transform =
            `translate3d(${-current * stepX}px, ${-current * stepY}px, 0)`;
    }

    /* Анимация запускается только когда есть что двигать
       и сама останавливается — без постоянной нагрузки на процессор. */
    function requestFrame() {
        if (frameId === null) {
            frameId = requestAnimationFrame(tick);
        }
    }

    function tick() {
        frameId = null;

        const smooth = reduceMotion ? 1 : (isLeaving ? CONFIG.exitSmooth : CONFIG.smooth);
        current += (target - current) * smooth;

        if (Math.abs(target - current) < CONFIG.epsilon) {
            current = target;
        }

        paint();

        if (current !== target) {
            requestFrame();
            return;
        }

        if (onSettled) {
            const callback = onSettled;
            onSettled = null;
            callback();
        }
    }

    function scrollBy(delta) {
        target = clamp(target + delta, 0, browseMax);
        requestFrame();
    }

    /* ---------------------------------------------------------------
     * 4. Окно объекта
     * ------------------------------------------------------------- */
    const modal = document.getElementById("imageModal");
    const modalPanel = modal.querySelector(".image-modal__panel");
    const modalImage = document.getElementById("modalImage");
    const modalTitle = document.getElementById("modalTitle");
    const modalMeta = document.getElementById("modalMeta");
    const modalText = document.getElementById("modalText");
    const modalClose = document.getElementById("modalClose");
    const modalBackdrop = document.getElementById("modalBackdrop");

    let lastFocused = null;

    function isModalOpen() {
        return modal.classList.contains("is-open");
    }

    function openModal(index) {
        const object = objects[index];

        if (!object || isLeaving) {
            return;
        }

        lastFocused = document.activeElement;

        modalImage.src = object.image;
        modalImage.alt = object.alt || object.title || "";
        modalTitle.textContent = object.title || "Объект";
        modalMeta.textContent = object.year || "";
        modalText.innerHTML = renderMarkdown(object.description);
        modalPanel.scrollTop = 0;

        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");

        modalClose.focus({ preventScroll: true });
    }

    function closeModal() {
        if (!isModalOpen()) {
            return;
        }

        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");

        if (lastFocused && typeof lastFocused.focus === "function") {
            lastFocused.focus({ preventScroll: true });
        }
    }

    /* Фокус не уходит за пределы открытого окна */
    function trapFocus(event) {
        const focusable = Array.from(
            modalPanel.querySelectorAll("button, a[href]")
        );

        if (!focusable.length) {
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    modalClose.addEventListener("click", closeModal);
    modalBackdrop.addEventListener("click", closeModal);

    /* ---------------------------------------------------------------
     * Управление: колесо, свайп, клавиатура
     * ------------------------------------------------------------- */
    window.addEventListener("wheel", (event) => {
        if (isModalOpen()) {
            return; // пусть прокручивается само окно с описанием
        }

        event.preventDefault();

        if (isLeaving) {
            return;
        }

        // deltaMode 1 — прокрутка строками (Firefox), переводим в пиксели
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
        scrollBy(delta / CONFIG.wheelStep);
    }, { passive: false });

    let touchY = null;

    window.addEventListener("touchstart", (event) => {
        touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    }, { passive: true });

    window.addEventListener("touchmove", (event) => {
        if (isModalOpen()) {
            return;
        }

        event.preventDefault();

        if (isLeaving || touchY === null) {
            return;
        }

        const y = event.touches[0].clientY;
        scrollBy((touchY - y) / CONFIG.touchStep);
        touchY = y;
    }, { passive: false });

    window.addEventListener("touchend", () => {
        touchY = null;
    });

    document.addEventListener("keydown", (event) => {
        if (isModalOpen()) {
            if (event.key === "Escape") {
                closeModal();
            } else if (event.key === "Tab") {
                trapFocus(event);
            }
            return;
        }

        if (isLeaving) {
            return;
        }

        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            scrollBy(1);
        } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            scrollBy(-1);
        }
    });

    let resizeFrame = null;

    window.addEventListener("resize", () => {
        if (resizeFrame !== null) {
            return;
        }

        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            layout();
        });
    });

    /* ---------------------------------------------------------------
     * 5. Переход на другие страницы
     * ------------------------------------------------------------- */
    function currentPageName() {
        return window.location.pathname.split("/").pop() || "index.html";
    }

    function bindMenu() {
        document.querySelectorAll(".menu-link").forEach((link) => {
            link.addEventListener("click", (event) => {
                // Даём браузеру открыть ссылку в новой вкладке (Cmd/Ctrl+клик и т.п.)
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                    return;
                }

                event.preventDefault();

                if (isLeaving) {
                    return;
                }

                const destination = link.getAttribute("href");

                // Уже на этой странице — возвращаем галерею в начало
                if (destination === currentPageName()) {
                    scrollBy(-Infinity);
                    return;
                }

                leaveTo(destination);
            });
        });
    }

    function leaveTo(destination) {
        closeModal();
        isLeaving = true;

        if (reduceMotion) {
            window.location.href = destination;
            return;
        }

        target = exitProgress;
        onSettled = () => {
            document.body.classList.add("page-leaving");
            setTimeout(() => {
                window.location.href = destination;
            }, CONFIG.exitDelay);
        };
        requestFrame();
    }

    // Возврат кнопкой «назад»: браузер может показать страницу из кэша
    // в состоянии «уходим» — сбрасываем его.
    window.addEventListener("pageshow", (event) => {
        if (!event.persisted) {
            return;
        }

        isLeaving = false;
        onSettled = null;
        target = 0;
        current = 0;
        document.body.classList.remove("page-leaving");
        paint();
    });

    /* ---------------------------------------------------------------
     * Запуск
     * ------------------------------------------------------------- */
    if (!objects.length) {
        console.error("Галерея: нет объектов. Проверьте data/objects.js");
        return;
    }

    renderGallery();
    layout();
    bindMenu();
})();
