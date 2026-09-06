# Locators

A locator is a query bound to a session. Building one performs no work. Holding one across an action is safe, because it stores a query rather than a reference to a node.

## The three factories

```ts
app.getByText('Welcome');
app.getByText(/welcome/i);
app.getByText('Welcome', { exact: true });

app.getByRole('button');
app.getByRole('button', { name: 'Sign in' });
app.getByRole('text', { name: 'Rob', exact: true });

app.getByTestId('profile-email');
```

`getByText` matches a node's accessibility name or its value, the way Playwright's own `getByText` matches text. `getByRole` matches the normalized role and, optionally, the name. `getByTestId` matches the accessibility identifier, which is what a React Native `testID` becomes, and it always matches the whole string.

## The escape hatch

`app.locator(query)` takes the raw query for anything the three factories cannot express.

```ts
app.locator({ role: 'text-field', focused: true });
app.locator({ testId: { kind: 'substring', value: 'row-' }, enabled: false });
app.locator({ where: (node) => node.rect !== null && node.rect.y > 400 });
```

A query is conjunctive. Every field narrows, and an empty query matches every node. The fields are `testId`, `name`, `value`, `role`, `enabled`, `selected`, `focused`, `where`, and `index`.

## Matching rules

Text matching follows Playwright. The default is a case-insensitive substring after whitespace is collapsed to single spaces. `exact: true` compares the whole string, case-sensitively, still after collapsing. A `RegExp` is tested against the collapsed string.

Whitespace is normalized on both sides of every comparison, so a label the app wrapped across two lines still matches one you typed on one line.

`getByText('Rob')` matches `rob@example.com` too, because a substring match is case-insensitive. Pass `{ exact: true }` to separate them.

## Strictness

A locator that resolves to more than one node is an error, for an action and for an assertion alike. `.not` cannot turn that into a pass, and neither can waiting, because waiting cannot make a locator less ambiguous. The failure lists every match.

```
Locator resolved to 2 nodes but an action needs exactly one.

Locator: getByText('Explore')
Matches:
  @e12 [text] "Explore"
  @e35 [button] "Explore"

Narrow it with getByRole, or take one deliberately with .first() or .nth(n).
```

Take one on purpose with `.first()` or `.nth(n)`. Negative indexes count from the end, so `.nth(-1)` is the last match.

```ts
await app.getByText('Explore').first().tap();
await app.getByRole('cell').nth(-1).tap();
```

`toHaveCount(n)` is the one matcher that is happy with many. It asks how many there are.

## Ancestor absorption

One case is handled for you. When several matches sit on one ancestor chain and carry the same string that the query matched on, only the deepest survives.

React Native renders a `Text` as a text node wrapped in another text node holding the same string, and a pressable as a labelled container around a button. Each pair is one thing on screen, so `getByRole('text', { name: 'Rob' })` finds one node rather than two.

Matches in disjoint subtrees stay distinct. A heading that says "Explore" and a tab button that says "Explore" are two things, and the failure says so.

A query that constrains no text falls back to the node's own name for this comparison, so `getByRole('button')` does not collapse two nested buttons that say different things.

## Roles

Roles are normalized to one vocabulary across iOS and Android, spelled the way `agent-device snapshot` prints them, so a failure message and a manual snapshot read alike.

| role                | iOS types it covers                                   | Android classes it covers                                |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `application`       | `Application`                                         |                                                          |
| `window`            | `Window`                                              |                                                          |
| `button`            | `Button`, `Tab`                                       | `Button`, `ImageButton`                                  |
| `text`              | `StaticText`, `TextView`                              | `TextView`                                               |
| `text-field`        | `TextField`, `SearchField`                            | `EditText`                                               |
| `secure-text-field` | `SecureTextField`                                     |                                                          |
| `link`              | `Link`                                                |                                                          |
| `image`             | `Image`, `Icon`                                       | `ImageView`                                              |
| `switch`            | `Switch`, `Toggle`                                    | `Switch`, `CheckBox`                                     |
| `slider`            | `Slider`                                              | `SeekBar`                                                |
| `tab-bar`           | `TabBar`                                              |                                                          |
| `scroll-area`       | `ScrollView`, `ScrollArea`, `Table`, `CollectionView` | `ScrollView`, `HorizontalScrollView`, `RecyclerView`     |
| `cell`              | `Cell`                                                |                                                          |
| `alert`             | `Alert`, `Sheet`                                      |                                                          |
| `other`             | `Other`, and anything unrecognized                    | `FrameLayout`, `LinearLayout`, and anything unrecognized |

`other` is a real role, not a failure signal. React Native emits many labelled container views with no semantic type. The platform spelling is kept on each node as `rawType` if you need it through `app.screen()`.

The Android table is inference until an Android run confirms it. Anything unrecognized falls through to `other`, which is always legal.
