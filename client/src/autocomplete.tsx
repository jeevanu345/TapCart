import { useEffect, useId, useRef, useState, type ComponentPropsWithoutRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import "./select.css";
type Props = Omit<
  ComponentPropsWithoutRef<"input">,
  "list" | "value" | "onChange" | "defaultValue"
> & { options: string[]; defaultValue?: string; onValueChange?: (value: string) => void };
/** Editable category input: existing suggestions are optional; new values remain valid. */
export function AutocompleteInput({
  options,
  defaultValue,
  onValueChange,
  onFocus,
  onKeyDown,
  ...props
}: Props) {
  const initial = String(defaultValue ?? ""),
    [internal, setInternal] = useState(initial),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null),
    anchor = useRef<HTMLDivElement>(null),
    listId = useId();
  const current = internal,
    matches = options
      .filter((option) => option.toLocaleLowerCase().includes(current.toLocaleLowerCase()))
      .slice(0, 30);
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const reset = (event: Event) =>
      queueMicrotask(() => {
        if (event.defaultPrevented) return;
        setInternal(initial);
        setOpen(false);
        setActive(-1);
      });
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initial]);
  function choose(option: string) {
    setInternal(option);
    onValueChange?.(option);
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  }
  return (
    <Popover.Root open={open && matches.length > 0} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="autocomplete-anchor" ref={anchor}>
          <input
            {...props}
            ref={input}
            value={current}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
            onFocus={(event) => {
              setOpen(true);
              onFocus?.(event);
            }}
            onChange={(event) => {
              setInternal(event.currentTarget.value);
              setOpen(true);
              setActive(-1);
              onValueChange?.(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (event.defaultPrevented) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!matches.length) return;
                event.preventDefault();
                setOpen(true);
                setActive((previous) =>
                  event.key === "ArrowDown"
                    ? (previous + 1) % matches.length
                    : previous <= 0
                      ? matches.length - 1
                      : previous - 1,
                );
              } else if (event.key === "Enter" && open && active >= 0 && matches[active]) {
                event.preventDefault();
                choose(matches[active]);
              } else if (event.key === "Escape" && open && matches.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setActive(-1);
              } else if (event.key === "Tab") {
                setOpen(false);
                setActive(-1);
              }
            }}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="select-menu autocomplete-menu"
          role="presentation"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => {
            if (event.target instanceof Node && anchor.current?.contains(event.target))
              event.preventDefault();
          }}
        >
          <div
            className="select-viewport"
            role="listbox"
            id={listId}
            aria-label="Category suggestions"
          >
            {matches.map((option, index) => (
              <button
                type="button"
                role="option"
                key={option}
                id={`${listId}-${index}`}
                aria-selected={active === index}
                tabIndex={-1}
                className="select-option autocomplete-option"
                data-highlighted={active === index ? "" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {current === option && <Check size={15} className="select-check" />}
                {option}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
