import { expect, test, type Browser, type Page } from '@playwright/test'

const BACKEND = 'http://localhost:54399'

const setNow = (iso: string) =>
  fetch(`${BACKEND}/__test/now`, { method: 'POST', body: JSON.stringify({ iso }) })

const runMaintenance = () => fetch(`${BACKEND}/__test/maintenance`, { method: 'POST' })

test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()))
})

const ownPassword = (login: string) => `${login}!own1`

async function signIn(
  browser: Browser, login: string, password: string, { pushAsked = true, choosePassword = true } = {},
) {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (pushAsked) await page.addInitScript(() => sessionStorage.setItem('opus-push-asked', '1'))
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (/WebSocket|realtime|status of 400/i.test(text)) return
    problems.push(text)
  })
  ;(page as Page & { problems: string[] }).problems = problems
  await page.goto('/')
  await page.getByLabel('Login').fill(login)
  await page.getByLabel('Password').fill(password)
  const button = page.getByRole('button', { name: 'Sign in' })
  await button.click()
  const wrong = page.getByText('Wrong login or password.')
  await expect.poll(async () => (await wrong.isVisible()) || !(await button.isVisible()), { timeout: 15_000 }).toBe(true)
  if (password === login && await wrong.isVisible()) {
    await page.getByLabel('Password').fill(ownPassword(login))
    await button.click()
  }
  await expect(button).toBeHidden()
  if (!choosePassword) return page
  const first = page.getByRole('heading', { name: 'Choose your own password' })
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasNotText: /^Sign in$/ }).first()).toBeVisible({ timeout: 15_000 })
  if (await first.isVisible()) {
    await page.getByLabel('New password', { exact: true }).fill(ownPassword(login))
    await page.getByLabel('Repeat new password').fill(ownPassword(login))
    await page.getByRole('button', { name: 'Save password' }).click()
    await expect(first).toBeHidden()
  }
  return page
}

const problemsOf = (page: Page) => (page as Page & { problems: string[] }).problems

async function createUser(admin: Page, role: 'student' | 'support', first: string, last: string) {
  await admin.goto(role === 'student' ? '/admin/students' : '/admin/supports')
  await admin.getByRole('button', { name: role === 'student' ? 'New student' : 'New support teacher' }).click()
  await admin.getByLabel('First name').fill(first)
  await admin.getByLabel('Last name').fill(last)
  if (role === 'student') await admin.getByLabel('Birth year').fill('2008')
  await admin.getByRole('button', { name: 'Create login and password' }).click()
  const login = await admin.getByTestId('new-login').textContent()
  const password = await admin.getByTestId('new-password').textContent()
  await admin.getByRole('button', { name: 'Done' }).click()
  return { login: login!, password: password! }
}

async function setHours(admin: Page, name: string) {
  await admin.goto('/admin/supports')
  await admin.getByRole('link', { name }).click()
  await admin.getByRole('button', { name: 'Add hours' }).click()
  await admin.getByRole('button', { name: 'Add hours' }).click()
  const days = admin.getByLabel('Day')
  await days.nth(0).selectOption('2')
  await days.nth(1).selectOption('3')
  await admin.getByRole('button', { name: 'Save schedule' }).click()
  await expect(admin.getByText('Schedule saved.')).toBeVisible()
}

const supportCard = (student: Page, name: string) =>
  student.getByRole('region').or(student.locator('section')).filter({ hasText: name })

async function bookFirstSlotAt(student: Page, teacher: string, time: string, topic: string) {
  await student.goto('/book')
  await supportCard(student, teacher).getByRole('button', { name: time }).click()
  await student.getByLabel('What do you want to study?').fill(topic)
  await student.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(student.getByText('Your next lesson')).toBeVisible()
}

async function bookFirstSlot(student: Page, teacher: string, topic: string) {
  await student.goto('/book')
  await supportCard(student, teacher).getByRole('button', { name: '14:00' }).click()
  await student.getByLabel('What do you want to study?').fill(topic)
  await student.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(student.getByText('Your next lesson')).toBeVisible()
}

test('the whole life of a lesson, across all three roles', async ({ browser }) => {
  await setNow('2030-01-07T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  await expect(admin.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  const ozodbek = await createUser(admin, 'support', 'Ozodbek', 'Karimov')
  const malika = await createUser(admin, 'support', 'Malika', 'Rahimova')
  const aziza = await createUser(admin, 'student', "Aziza", 'Karimova')
  expect(aziza.login).toBe('aziza.karimova08')
  await setHours(admin, 'Ozodbek Karimov')
  await setHours(admin, 'Malika Rahimova')

  const guest = await browser.newPage()
  await guest.goto('/')
  await expect(guest.getByRole('region', { name: 'New to the site?' })).toContainText('reception')
  await guest.getByLabel('Login').fill(aziza.login)
  await guest.getByLabel('Password').fill('wrong-password')
  await guest.getByRole('button', { name: 'Sign in' }).click()
  await expect(guest.getByText('Wrong login or password.')).toBeVisible()

  const student = await signIn(browser, aziza.login, aziza.password)
  await expect(student.getByText('Hello, Aziza')).toBeVisible()
  await bookFirstSlot(student, 'Ozodbek', 'Present Perfect')
  await expect(student.locator('section.hero')).toContainText('Tue 8 Jan')
  await expect(student.locator('section.hero')).toContainText('14:00')

  await student.goto('/book')
  await expect(student.getByText('You already have an active booking')).toBeVisible()
  await expect(student.getByRole('button', { name: '14:00' })).toBeHidden()

  const support = await signIn(browser, ozodbek.login, ozodbek.password)
  await expect(support.getByTestId('role-badge')).toHaveText('Support teacher')
  await expect(student.getByTestId('role-badge')).toHaveText('Student')
  await expect(support.getByText('Aziza Karimova').first()).toBeVisible()
  await expect(support.getByText('Present Perfect')).toBeVisible()

  await student.goto('/chat')
  await student.getByRole('link', { name: /Ozodbek/ }).click()
  await student.getByLabel('Write a message').fill('Hello teacher')
  await student.getByRole('button', { name: 'Send' }).click()
  await support.goto('/chat')
  await support.getByRole('link', { name: /Aziza/ }).click()
  await expect(support.getByText('Hello teacher')).toBeVisible()

  await admin.goto('/admin/chats')
  await admin.getByRole('link', { name: /Aziza Karimova · Ozodbek Karimov/ }).click()
  await expect(admin.getByText('Hello teacher')).toBeVisible()
  await admin.getByLabel('Write a message').fill('Admin is here')
  await admin.getByRole('button', { name: 'Send' }).click()
  await expect(support.getByText('Admin is here')).toBeVisible({ timeout: 10000 })
  await expect(student.getByText('The center can read these messages.')).toBeVisible()

  await setNow('2030-01-08T14:03:00+05:00')
  await support.goto('/')
  await expect(support.getByRole('button', { name: /Did not come · From 14:10/ })).toBeDisabled()
  await support.getByRole('button', { name: 'Came' }).click()
  const shown = await support.getByTestId('checkin-code').textContent()
  await student.goto('/')
  await student.getByLabel('Or type the 6-digit code').fill(shown!)
  await student.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(student.getByText('You are checked in. Have a good lesson!')).toBeVisible()
  await expect(support.getByRole('dialog')).toBeHidden({ timeout: 10000 })
  await expect(support.getByText('Attended').first()).toBeVisible()

  await student.goto('/')
  await expect(student.getByText('No lesson booked')).toBeVisible()
  await expect(student.getByRole('button', { name: 'Send review' })).toBeHidden()
  await setNow('2030-01-08T14:31:00+05:00')
  await runMaintenance()
  await student.goto('/')
  await expect(student.getByText('You can rate this lesson until Tue 8 Jan, 23:59.')).toBeVisible()
  await student.getByRole('radio', { name: '5 stars' }).click()
  await student.getByLabel('Add a comment').fill('Very clear')
  await student.getByRole('button', { name: 'Send review' }).click()
  await expect(student.getByText('Thank you for your review.')).toBeVisible()
  await student.goto('/history')
  await expect(student.getByText('Very clear')).toBeVisible()
  await student.goto('/supports')
  await expect(student.getByText('5.0').first()).toBeVisible()
  await student.getByRole('link', { name: /Ozodbek/ }).click()
  await expect(student.getByText('Comments are read only by the center.')).toBeVisible()
  await expect(student.getByText('Very clear')).toBeHidden()
  await support.goto('/history')
  await expect(support.getByText('Aziza Karimova').first()).toBeVisible()
  await expect(support.getByText('Very clear')).toBeHidden()
  await admin.goto('/admin/reviews')
  await expect(admin.getByText('Very clear')).toBeVisible()

  await setNow('2030-01-08T15:00:00+05:00')
  await bookFirstSlot(student, 'Ozodbek', 'Vocabulary')
  await setNow('2030-01-09T14:11:00+05:00')
  await support.goto('/')
  await support.getByRole('button', { name: 'Did not come' }).click()
  await student.goto('/')
  await expect(student.getByText('You have a warning')).toBeVisible()
  await student.goto('/history')
  await expect(student.getByRole('button', { name: 'Report a problem' })).toHaveCount(1)
  await student.getByRole('button', { name: 'Report a problem' }).click()
  await expect(student.getByText('You can send it until Wed 9 Jan, 23:59.')).toBeVisible()
  await student.keyboard.press('Escape')

  await setNow('2030-01-09T15:00:00+05:00')
  await student.goto('/book')
  await student.getByRole('button', { name: /Tue 15 Jan/ }).click()
  await supportCard(student, 'Malika').getByRole('button', { name: '14:00' }).click()
  await student.getByLabel('What do you want to study?').fill('Listening')
  await student.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(student.getByText('Your next lesson')).toBeVisible()

  await setNow('2030-01-15T14:11:00+05:00')
  const malikaPage = await signIn(browser, malika.login, malika.password)
  await malikaPage.getByRole('button', { name: 'Did not come' }).click()
  await student.goto('/')
  await expect(student.getByText('Booking is blocked')).toBeVisible()
  await expect(student.getByRole('link', { name: 'Book a lesson' })).toBeHidden()

  await admin.goto('/admin/penalties')
  await admin.getByRole('button', { name: 'Lift' }).first().click()
  await expect(admin.getByText('Ban lifted.')).toBeVisible()
  await student.goto('/')
  await expect(student.getByText('Booking is blocked')).toBeHidden()

  for (const page of [admin, student, support, malikaPage]) {
    expect(problemsOf(page)).toEqual([])
  }
})

test('a closed day moves the student to another support', async ({ browser }) => {
  await setNow('2030-02-04T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const dilnoza = await createUser(admin, 'student', 'Dilnoza', 'Usmonova')

  const student = await signIn(browser, dilnoza.login, dilnoza.password)
  await bookFirstSlot(student, 'Ozodbek', 'Reading')

  const support = await signIn(browser, 'ozodbek.karimov', await resetPassword(admin, 'Ozodbek Karimov'))
  await support.getByLabel('Date').fill('2030-02-05')
  await support.getByRole('button', { name: 'Close this time' }).click()
  const confirm = support.getByRole('dialog')
  await expect(confirm.getByText('Booked lessons affected: 1')).toBeVisible()
  await expect(confirm.getByText('Dilnoza Usmonova')).toBeVisible()
  await expect(confirm.getByText('Offered another free support teacher at the same time.')).toBeVisible()
  await support.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(support.getByText(/1 students were notified/)).toBeVisible()
  await expect(support.getByRole('button', { name: 'Reopen' })).toHaveCount(1)

  await admin.goto('/admin/days')
  await admin.getByLabel('Date').fill('2030-02-06')
  await admin.getByRole('combobox', { name: 'Who' }).selectOption({ label: 'Ozodbek Karimov' })
  await admin.getByLabel('Reason').fill('Leave')
  await admin.getByRole('button', { name: 'Close', exact: true }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Yes, continue' }).click()
  await expect(admin.getByText('Day closed.')).toBeVisible()
  await support.reload()
  await expect(support.getByText('Closed by the center')).toBeVisible()
  await expect(support.getByRole('button', { name: 'Reopen' })).toHaveCount(1)

  await student.goto('/')
  await expect(student.getByText('Your support teacher is not available')).toBeVisible()
  await student.getByRole('button', { name: 'Malika Rahimova' }).click()
  await expect(student.getByText('Malika Rahimova')).toBeVisible()
  await expect(student.getByText('Your next lesson')).toBeVisible()

  await student.goto('/alerts')
  await expect(student.getByText('Your support teacher is unavailable')).toBeVisible()
})

test('settings change the site at once', async ({ browser }) => {
  await setNow('2030-03-04T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  await admin.goto('/admin/settings')
  await admin.getByLabel('Center name').fill('OPUS Fergana')
  await admin.getByRole('button', { name: /Save 1 change/ }).click()
  await expect(admin.getByText('Settings saved.')).toBeVisible()

  await admin.goto('/admin/texts')
  await admin.getByLabel('Search texts').fill('login.title')
  await admin.getByRole('button', { name: /login\.title/ }).click()
  await admin.getByLabel('Text', { exact: true }).fill('Welcome back')
  await admin.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(admin.getByText('Saved.')).toBeVisible()

  const guest = await browser.newPage()
  await guest.goto('/')
  await expect(guest.getByText('OPUS Fergana', { exact: true })).toBeVisible()
  await expect(guest.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('closed hours and taken times show greyed out', async ({ browser }) => {
  await setNow('2030-05-06T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const password = await resetPassword(admin, 'Malika Rahimova')
  const support = await signIn(browser, 'malika.rahimova', password)

  await expect(support.getByLabel('Date')).toHaveAttribute('min', '2030-05-06')
  await support.getByLabel('Date').fill('2030-05-07')
  await support.getByLabel('Whole day').uncheck()
  await support.getByLabel('From').fill('15:00')
  await support.getByLabel('To', { exact: true }).fill('16:00')
  await support.getByRole('button', { name: 'Close this time' }).click()
  await support.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(support.getByText('15:00-16:00')).toBeVisible()

  const nigora = await createUser(admin, 'student', 'Nigora', 'Saidova')
  const student = await signIn(browser, nigora.login, nigora.password)
  await student.goto('/book')
  const card = supportCard(student, 'Malika')
  await expect(card.getByRole('button', { name: '15:00' })).toBeDisabled()
  await expect(card.getByRole('button', { name: '15:30' })).toBeDisabled()
  await expect(card.getByRole('button', { name: '16:00' })).toBeEnabled()
})

test('a new account starts with the login as the password, and must choose its own', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  const odina = await createUser(admin, 'student', 'Odina', 'Qosimova')
  expect(odina.password).toBe(odina.login)

  const page = await signIn(browser, odina.login, odina.password, { choosePassword: false })
  const first = page.getByRole('heading', { name: 'Choose your own password' })
  await expect(first).toBeVisible()
  await page.goto('/book')
  await expect(first).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill(odina.login)
  const eye = page.getByRole('button', { name: 'Show what you typed' }).first()
  await eye.click()
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide what you typed' }).first().click()
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'password')
  await page.getByLabel('Repeat new password').fill(odina.login)
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByText('Choose a password that is different from your login.')).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill('odina-own-pass')
  await page.getByLabel('Repeat new password').fill('odina-own-pass')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('heading', { name: 'Book a lesson' }).or(page.getByText('Hello, Odina'))).toBeVisible()

  await admin.goto('/admin/students')
  await admin.getByRole('link', { name: 'Odina Qosimova' }).click()
  await admin.getByRole('button', { name: 'Reset password' }).click()
  await expect(admin.getByTestId('new-password')).toHaveText(odina.login)
  await admin.getByRole('button', { name: 'Done' }).click()
  const again = await signIn(browser, odina.login, odina.login, { choosePassword: false })
  await expect(again.getByRole('heading', { name: 'Choose your own password' })).toBeVisible()
})

test('a second-level admin runs the desk, but cannot change lessons or use developer tools', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  await admin.goto('/admin/managers')
  await admin.getByRole('button', { name: 'New second-level admin' }).click()
  await admin.getByLabel('First name').fill('Front')
  await admin.getByLabel('Last name').fill('Desk')
  await admin.getByRole('button', { name: 'Create login and password' }).click()
  const login = (await admin.getByTestId('new-login').textContent())!
  const password = (await admin.getByTestId('new-password').textContent())!
  expect(password).not.toBe(login)
  await admin.getByRole('button', { name: 'Done' }).click()

  const desk = await signIn(browser, login, password, { choosePassword: false })
  await expect(desk.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(desk.getByRole('button', { name: 'Download all data' })).toBeVisible()

  const pupil = await createUser(desk, 'student', 'Sevara', 'Olimova')
  expect(pupil.password).toBe(pupil.login)
  await desk.goto('/admin/students')
  await desk.getByRole('link', { name: 'Sevara Olimova' }).click()
  await desk.getByRole('button', { name: 'Show password' }).click()
  await expect(desk.getByTestId('shown-password')).toHaveText(pupil.login)
  for (const name of ['Sign in as this person', 'Reset password', 'Change login', 'Send a message',
    'Ban from booking', 'Add a warning', 'Delete forever', 'Hide from ranking']) {
    await expect(desk.getByRole('button', { name })).toHaveCount(0)
  }
  await expect(desk.getByRole('button', { name: 'Make inactive' })).toBeVisible()

  await signIn(browser, pupil.login, pupil.password)
  await desk.reload()
  await expect(desk.getByRole('button', { name: 'Show password' })).toHaveCount(0)

  await desk.goto('/admin/bookings')
  await expect(desk.getByRole('heading', { name: 'Bookings' })).toBeVisible()
  await expect(desk.getByRole('button', { name: 'Book', exact: true })).toHaveCount(0)
  await expect(desk.getByLabel('Set attendance')).toHaveCount(0)
  for (const path of ['/admin/settings', '/admin/chats', '/admin/penalties', '/admin/audit', '/admin/managers', '/admin/messages', '/admin/texts']) {
    await desk.goto(path)
    await expect(desk).not.toHaveURL(path)
  }
  for (const path of ['/admin/stats', '/admin/reviews', '/admin/complaints', '/admin/days', '/top', '/guide']) {
    await desk.goto(path)
    await expect(desk).toHaveURL(path)
    await expect(desk.getByRole('heading', { level: 1 }).first()).toBeVisible()
  }
  await desk.goto('/profile')
  await expect(desk.getByLabel('New password', { exact: true })).toHaveCount(0)
  expect(problemsOf(desk)).toEqual([])
})

test('the admin sees passwords, including ones the user changed', async ({ browser }) => {
  await setNow('2030-06-03T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const kamol = await createUser(admin, 'student', 'Kamol', 'Nazarov')

  await admin.goto('/admin/students')
  await admin.getByRole('link', { name: 'Kamol Nazarov' }).click()
  await admin.getByRole('button', { name: 'Show password' }).click()
  await expect(admin.getByTestId('shown-password')).toHaveText(kamol.password)

  const student = await signIn(browser, kamol.login, kamol.password)
  await student.goto('/profile')
  await student.getByLabel('New password', { exact: true }).fill('kamol-new-pass')
  await student.getByLabel('Repeat new password').fill('kamol-new-pass')
  await student.getByRole('button', { name: 'Save password' }).click()
  await expect(student.getByText('Password changed.')).toBeVisible()

  await admin.reload()
  await admin.getByRole('button', { name: 'Show password' }).click()
  await expect(admin.getByTestId('shown-password')).toHaveText('kamol-new-pass')
  await expect(admin.getByText(/Changed by the user/)).toBeVisible()

  await admin.goto('/alerts')
  await expect(admin.getByText('Kamol Nazarov changed their password.').first()).toBeVisible()
  await admin.goto('/admin/audit')
  await expect(admin.getByText('Viewed a password').first()).toBeVisible()

  await signIn(browser, kamol.login, 'kamol-new-pass')
})

test('the monthly report counts lessons per support', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  await admin.goto('/admin/stats')
  await admin.getByLabel('Month').fill('2030-01')
  await expect(admin.getByRole('row', { name: /Ozodbek Karimov 1 0 0\.5/ })).toBeVisible()

  const load = admin.getByRole('region', { name: 'Support teachers this week' })
  await expect(load.getByRole('row', { name: /Ozodbek Karimov/ })).toContainText('/8')
  await load.getByRole('button', { name: /Next week/ }).click()
  await expect(load.getByRole('row', { name: /Malika Rahimova/ })).toContainText('/8')
})

test('a student changes the time of a lesson without cancelling it', async ({ browser }) => {
  await setNow('2031-03-03T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const user = await createUser(admin, 'student', 'Kamola', 'Ismoilova')
  const student = await signIn(browser, user.login, user.password)
  await bookFirstSlotAt(student, 'Malika', '14:30', 'Past Perfect')
  await expect(student.getByText('Time changes left this month: 2. No wait and no penalty.')).toBeVisible()

  await student.getByRole('link', { name: 'Change time' }).click()
  await expect(student.getByText('Choose a new time')).toBeVisible()
  await supportCard(student, 'Ozodbek').getByRole('button', { name: '16:00' }).click()
  const dialog = student.getByRole('dialog')
  await expect(dialog.getByLabel('What do you want to study?')).toHaveValue('Past Perfect')
  await dialog.getByRole('button', { name: 'Move the lesson here' }).click()
  await expect(student.locator('section.hero')).toContainText('16:00')
  await expect(student.locator('section.hero')).toContainText('Ozodbek Karimov')
  await expect(student.getByText('Time changes left this month: 1. No wait and no penalty.')).toBeVisible()
  await expect(student.getByText(/Booking opens again/)).toBeHidden()
})

test('the admin has full control of people and lessons', async ({ browser }) => {
  await setNow('2030-07-01T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const rano = await createUser(admin, 'student', 'Rano', 'Ergasheva')
  const student = await signIn(browser, rano.login, rano.password)
  await bookFirstSlot(student, 'Ozodbek', 'First topic')

  await admin.goto('/admin/students')
  await admin.getByRole('link', { name: 'Rano Ergasheva' }).click()
  await admin.getByRole('button', { name: 'Sign in as this person' }).click()
  await expect(admin.getByText('Admin view: signed in as Rano Ergasheva')).toBeVisible()
  await expect(admin.getByText('First topic')).toBeVisible()
  await admin.getByRole('button', { name: 'Back to admin' }).click()
  await expect(admin.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(admin.getByText('Admin view')).toBeHidden()

  await admin.goto('/admin/bookings')
  await admin.getByLabel('Student').fill('Rano')
  await admin.getByLabel('From').fill('2030-07-01')
  await admin.getByLabel('To', { exact: true }).fill('2030-07-31')
  await admin.getByRole('button', { name: 'Edit lesson' }).click()
  await admin.getByRole('dialog').getByLabel('Topic').fill('Changed topic')
  await admin.getByRole('button', { name: 'Save topic' }).click()
  await expect(admin.getByText('Changed topic').first()).toBeVisible()
  await admin.getByRole('button', { name: 'Edit lesson' }).click()
  await admin.getByLabel('New time').selectOption({ label: '16:00' })
  await admin.getByRole('button', { name: 'Move lesson' }).click()
  await expect(admin.getByText('Lesson moved.')).toBeVisible()
  await student.goto('/')
  await expect(student.locator('section.hero')).toContainText('Tue 2 Jul')
  await expect(student.locator('section.hero')).toContainText('16:00')
  await expect(student.getByText('Changed topic')).toBeVisible()

  await admin.goto('/admin/messages')
  await admin.getByLabel('Send to').selectOption('one')
  await admin.getByLabel('Person').selectOption({ label: 'Rano Ergasheva' })
  await admin.getByLabel('Title').fill('Hello Rano')
  await admin.getByLabel('Message').fill('Please call us')
  await admin.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(admin.getByText('Message sent.')).toBeVisible()
  await student.goto('/alerts')
  await expect(student.getByText('Please call us')).toBeVisible()

  await admin.goto('/admin/students')
  await admin.getByRole('link', { name: 'Rano Ergasheva' }).click()
  await admin.getByRole('button', { name: 'Move to archive' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Move to archive' }).click()
  await expect(admin.getByText('In the archive')).toBeVisible()
  await expect(admin.getByRole('button', { name: 'Sign in as this person' })).toBeHidden()

  await student.goto('/')
  await expect(student.getByRole('button', { name: 'Sign in' })).toBeVisible()

  await admin.goto('/admin/students')
  await expect(admin.getByRole('link', { name: 'Rano Ergasheva' })).toBeHidden()
  await admin.getByRole('button', { name: /^Archive/ }).click()
  await admin.getByRole('link', { name: 'Rano Ergasheva' }).click()
  await expect(admin.getByText('Lessons (1)')).toBeVisible()
  await admin.getByRole('button', { name: 'Restore from archive' }).click()
  await expect(admin.getByText('In the archive')).toBeHidden()

  await admin.getByRole('button', { name: 'Delete forever' }).click()
  const confirm = admin.getByRole('dialog').getByRole('button', { name: 'Delete forever' })
  await expect(confirm).toBeDisabled()
  await admin.getByLabel('Type Rano Ergasheva to confirm').fill('Rano Ergasheva')
  await confirm.click()
  await expect(admin.getByText('Account deleted.')).toBeVisible()
})

test('favorites, waiting list, calendar, and booking closed after cancelling', async ({ browser }) => {
  await setNow('2030-08-05T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const one = await createUser(admin, 'student', 'Laylo', 'Tursunova')
  const two = await createUser(admin, 'student', 'Sherzod', 'Qodirov')
  const first = await signIn(browser, one.login, one.password)
  const second = await signIn(browser, two.login, two.password)

  await bookFirstSlot(first, 'Ozodbek', 'Listening')

  await second.goto('/book')
  await supportCard(second, 'Ozodbek').getByRole('button', { name: 'Favorite support teacher' }).click()
  await expect(supportCard(second, 'Ozodbek').getByRole('button', { name: 'Favorite support teacher' })).toHaveAttribute('aria-pressed', 'true')
  await expect(second.locator('section').filter({ has: second.getByRole('button', { name: 'Favorite support teacher' }) }).first()).toContainText('Ozodbek Karimov')

  await supportCard(second, 'Ozodbek').getByRole('button', { name: /14:00 taken/ }).click()
  await second.getByRole('button', { name: 'Join the waiting list', exact: true }).click()
  await expect(second.getByText('You are on the waiting list.')).toBeVisible()

  await first.goto('/')
  await first.getByRole('button', { name: 'Add to calendar' }).click()
  const file = first.waitForEvent('download')
  await first.getByRole('button', { name: 'Phone calendar' }).click()
  expect((await file).suggestedFilename()).toBe('opus-lesson.ics')

  await expect(first.getByRole('link', { name: 'Change time' })).toBeVisible()
  await first.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(first.getByRole('dialog').getByText(/you can book again from .*00:00/)).toBeVisible()
  await first.getByRole('dialog').getByRole('button', { name: 'Yes, continue' }).click()
  await expect(first.getByText(/Booking opens again on .*, 00:00/)).toBeVisible()
  await first.goto('/book')
  await expect(first.getByText(/so you can book again from/)).toBeVisible()
  await expect(first.getByRole('button', { name: '15:00' })).toHaveCount(0)

  await admin.goto('/admin/students')
  await expect(admin.getByText('No notifications').first()).toBeVisible()
  await admin.getByRole('link', { name: 'Laylo Tursunova' }).click()
  await expect(admin.getByText('off on every device')).toBeVisible()
  await admin.getByRole('button', { name: 'Open booking now' }).click()
  await expect(admin.getByText('Booking is open.')).toBeVisible()
  await first.goto('/book')
  await expect(supportCard(first, 'Malika').getByRole('button', { name: '15:00' })).toBeVisible()

  await second.goto('/alerts')
  await expect(second.getByText('A time just opened')).toBeVisible()
})

test('a lost connection is shown clearly and never as a booked lesson', async ({ browser }) => {
  await setNow('2030-09-02T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const user = await createUser(admin, 'student', 'Nodira', 'Azimova')
  const student = await signIn(browser, user.login, user.password)
  await student.goto('/book')
  await supportCard(student, 'Ozodbek').getByRole('button', { name: '14:00' }).click()
  await student.getByLabel('What do you want to study?').fill('Offline test')

  await student.context().setOffline(true)
  await expect(student.getByText('No internet.')).toBeVisible()
  await student.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(student.getByText(/No connection, so this was not confirmed/)).toBeVisible()
  await expect(student.getByRole('button', { name: 'Confirm booking' })).toBeVisible()

  await student.context().setOffline(false)
  await expect(student.getByText('No internet.')).toBeHidden()
  await student.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(student.getByText('Your next lesson')).toBeVisible()
})

test('a saved lesson is recognised even if the answer never arrived', async ({ browser }) => {
  await setNow('2030-09-09T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const user = await createUser(admin, 'student', 'Umid', 'Rasulov')
  const student = await signIn(browser, user.login, user.password)
  await student.goto('/book')
  await supportCard(student, 'Malika').getByRole('button', { name: '14:00' }).click()
  await student.getByLabel('What do you want to study?').fill('Lost answer')

  await student.route('**/rpc/book_lesson', async (route) => {
    await route.fetch()
    await route.abort('failed')
  })
  await student.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(student.getByText('Your next lesson')).toBeVisible()
  await expect(student.getByText('Lost answer')).toBeVisible()
})

test('who taught whom and the full download are available', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  await admin.goto('/admin/stats')
  await admin.getByLabel('Report from').fill('2030-01-01')
  await admin.getByLabel('Report to').fill('2030-12-31')
  await expect(admin.getByRole('row', { name: /Ozodbek Karimov Aziza Karimova 1/ })).toBeVisible()

  await admin.goto('/admin')
  const download = admin.waitForEvent('download')
  await admin.getByRole('button', { name: 'Download all data' }).click()
  expect((await download).suggestedFilename()).toMatch(/^opus-all-data-.*\.xlsx$/)
})

test('a mismatched password is refused with a clear message', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  const user = await createUser(admin, 'student', 'Komil', 'Hamidov')
  const student = await signIn(browser, user.login, user.password)
  await student.goto('/profile')
  await student.getByLabel('New password', { exact: true }).fill('first-password')
  await student.getByLabel('Repeat new password').fill('second-password')
  await student.getByRole('button', { name: 'Save password' }).click()
  await expect(student.getByText('The passwords do not match.')).toBeVisible()
  await signIn(browser, user.login, user.password)
})

test('a student cannot open the admin area', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  const bobur = await createUser(admin, 'student', 'Bobur', 'Aliyev')
  const student = await signIn(browser, bobur.login, bobur.password)
  await student.goto('/admin/settings')
  await expect(student).toHaveURL('/')
  await expect(student.getByRole('link', { name: 'Book a lesson' }).first()).toBeVisible()
  await student.goto('/no-such-page')
  await expect(student.getByText('This page does not exist.')).toBeVisible()
})

test('signing in after someone else leaves their page opens your own home', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  const lola = await createUser(admin, 'student', 'Lola', 'Yusupova')
  await admin.goto('/admin/days')
  await expect(admin.getByRole('heading', { name: 'Closed days', exact: true })).toBeVisible()
  await admin.goto('/profile')
  await admin.getByRole('button', { name: 'Sign out' }).click()
  await admin.goBack()
  await expect(admin).toHaveURL('/admin/days')

  await admin.getByLabel('Login').fill(lola.login)
  await admin.getByLabel('Password').fill(lola.password)
  await admin.getByRole('button', { name: 'Sign in' }).click()
  await expect(admin).toHaveURL('/')
  await expect(admin.getByText('This page does not exist.')).toBeHidden()

  await admin.goto('/history')
  await expect(admin).toHaveURL('/history')
})

test('the same person is never added twice: the admin gets the account they have', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  const first = await createUser(admin, 'student', 'Zarina', 'Olimova')
  await admin.goto('/admin/students')
  await admin.getByRole('button', { name: 'New student' }).click()
  await admin.getByLabel('First name').fill('zarina ')
  await admin.getByLabel('Last name').fill('OLIMOVA')
  await admin.getByLabel('Birth year').fill('2008')
  await admin.getByRole('button', { name: 'Create login and password' }).click()
  const card = admin.getByRole('dialog', { name: 'Already has an account' })
  await expect(card.getByTestId('new-login')).toHaveText(first.login)
  await expect(card.getByTestId('new-password')).toHaveText(first.password)
  await card.getByRole('link', { name: 'Open their page' }).click()
  await expect(admin.getByRole('heading', { name: 'Zarina Olimova' })).toBeVisible()
  await admin.goto('/admin/students')
  await admin.getByLabel('Search').fill('Olimova')
  await expect(admin.getByRole('link', { name: 'Zarina Olimova' })).toHaveCount(1)
})

test('a lesson found long after the job was down brings no penalty', async ({ browser }) => {
  await setNow('2030-04-01T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const sardor = await createUser(admin, 'student', 'Sardor', 'Yusupov')
  const student = await signIn(browser, sardor.login, sardor.password)
  await bookFirstSlot(student, 'Malika', 'Writing')

  await setNow('2030-04-03T09:00:00+05:00')
  await runMaintenance()
  await student.goto('/')
  await expect(student.getByText('No lesson booked')).toBeVisible()
  await expect(student.getByText('You have a warning')).toBeHidden()

  await admin.goto('/admin')
  const item = admin.getByRole('region', { name: 'Do today' }).getByRole('listitem')
    .filter({ hasText: 'Mark the lesson: Sardor Yusupov' })
  await expect(item).toContainText('Overdue')
  await item.getByRole('button', { name: 'Came' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Yes, continue' }).click()
  await expect(item).toBeHidden()
})

async function resetPassword(admin: Page, name: string) {
  await admin.goto('/admin/supports')
  await admin.getByRole('link', { name }).click()
  await admin.getByRole('button', { name: 'Reset password' }).click()
  const password = await admin.getByTestId('new-password').textContent()
  await admin.getByRole('button', { name: 'Done' }).click()
  return password!
}

test.describe('dialogs by keyboard', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })

  const focusIsInside = (page: Page) =>
    page.evaluate(() => {
      const dialogs = document.querySelectorAll('[role="dialog"]')
      return dialogs[dialogs.length - 1].contains(document.activeElement)
    })

  test('focus enters, stays inside, and returns to the button that opened it', async ({ browser }) => {
    const admin = await signIn(browser, 'admin', 'admin12345')
    await admin.goto('/admin/bookings')
    const opener = admin.getByRole('button', { name: 'Book', exact: true })
    await opener.focus()
    await admin.keyboard.press('Enter')

    const dialog = admin.getByRole('dialog', { name: 'Book for a student' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Student')).toBeFocused()
    await expect(admin.locator('#root')).toHaveAttribute('inert', '')

    for (let press = 0; press < 12; press++) {
      await admin.keyboard.press('Tab')
      expect(await focusIsInside(admin)).toBe(true)
    }
    for (let press = 0; press < 12; press++) {
      await admin.keyboard.press('Shift+Tab')
      expect(await focusIsInside(admin)).toBe(true)
    }

    await admin.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(admin.locator('#root')).not.toHaveAttribute('inert', '')
    await expect(opener).toBeFocused()
  })

  test('a dialog opened from a dialog closes on its own', async ({ browser }) => {
    await setNow('2030-10-07T10:00:00+05:00')
    const admin = await signIn(browser, 'admin', 'admin12345')
    const nodira = await createUser(admin, 'student', 'Nodira', 'Saidova')
    const student = await signIn(browser, nodira.login, nodira.password)
    await bookFirstSlot(student, 'Ozodbek', 'Keyboard topic')

    await admin.goto('/admin/bookings')
    await admin.getByLabel('From').fill('2030-10-01')
    await admin.getByLabel('To', { exact: true }).fill('2030-10-31')
    const edit = admin.getByRole('row', { name: /Nodira Saidova/ }).getByRole('button', { name: 'Edit lesson' })
    await edit.click()
    const lesson = admin.getByRole('dialog', { name: /Nodira Saidova/ })
    const remove = lesson.getByRole('button', { name: 'Delete from history' })
    await remove.click()
    const confirm = admin.getByRole('dialog', { name: 'Delete from history' })
    await expect(confirm).toBeVisible()
    expect(await focusIsInside(admin)).toBe(true)

    await admin.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await expect(lesson).toBeVisible()
    await expect(remove).toBeFocused()

    await admin.keyboard.press('Escape')
    await expect(lesson).toBeHidden()
    await expect(edit).toBeFocused()
  })
})

test('on a phone a dialog takes focus without opening the keyboard', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  await admin.goto('/admin/bookings')
  await admin.getByRole('button', { name: 'Book', exact: true }).click()
  const dialog = admin.getByRole('dialog', { name: 'Book for a student' })
  await expect(dialog).toBeFocused()
})

test('a page that fails to download repairs itself, or offers another try', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  const dashboard = admin.getByRole('heading', { name: 'Dashboard' })
  await expect(dashboard).toBeVisible()

  let blocked = 0
  await admin.route('**/AdminRoutes.tsx*', (route) => {
    blocked += 1
    return blocked === 1 ? route.abort() : route.continue()
  })
  await admin.reload()
  await expect(dashboard).toBeVisible()
  expect(blocked).toBeGreaterThan(1)

  await admin.unroute('**/AdminRoutes.tsx*')
  await admin.route('**/AdminRoutes.tsx*', (route) => route.abort())
  await admin.reload()
  const retry = admin.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible()

  await admin.unroute('**/AdminRoutes.tsx*')
  await retry.click()
  await expect(dashboard).toBeVisible()
})

test('excused and automatic no-show lessons, with history, statistics and rules', async ({ browser }) => {
  await setNow('2030-11-04T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const gulnoza = await createUser(admin, 'student', 'Gulnoza', 'Aliyeva')
  const student = await signIn(browser, gulnoza.login, gulnoza.password)
  const support = await signIn(browser, 'ozodbek.karimov', await resetPassword(admin, 'Ozodbek Karimov'))
  await bookFirstSlot(student, 'Ozodbek', 'Excused topic')

  await setNow('2030-11-05T09:00:00+05:00')
  await support.goto('/')
  await support.getByRole('button', { name: 'Excused', exact: true }).click()
  const excuse = support.getByRole('dialog', { name: /Excuse Gulnoza Aliyeva/ })
  await expect(excuse.getByRole('button', { name: 'Mark as excused' })).toBeDisabled()
  await excuse.getByLabel('Why can they not come?').fill('Ill, wrote in chat')
  await excuse.getByRole('button', { name: 'Mark as excused' }).click()
  await expect(support.getByText('Reason: Ill, wrote in chat')).toBeVisible()

  await student.goto('/history')
  await expect(student.getByText('Reason: Ill, wrote in chat')).toBeVisible()
  await expect(student.getByRole('listitem').getByText('Excused', { exact: true })).toBeVisible()
  await student.goto('/')
  await expect(student.getByText('You have a warning')).toBeHidden()
  await expect(student.getByText(/Booking opens again on .*, 00:00/)).toBeVisible()

  await setNow('2030-11-05T15:00:00+05:00')
  await support.goto('/')
  await expect(support.getByText('Excused topic')).toBeHidden()
  await expect(support.getByText('Finished today: 1')).toBeVisible()
  await support.getByRole('link', { name: 'See them in History' }).click()
  await expect(support.getByText('Excused topic')).toBeVisible()

  await setNow('2030-11-06T10:00:00+05:00')
  await bookFirstSlot(student, 'Ozodbek', 'Forgotten topic')
  await setNow('2030-11-12T14:15:00+05:00')
  await runMaintenance()
  await student.goto('/alerts')
  await expect(student.getByText('Your lesson is not marked yet')).toBeVisible()
  await support.goto('/alerts')
  await expect(support.getByText('Mark this lesson now')).toBeVisible()

  await setNow('2030-11-12T14:40:00+05:00')
  await runMaintenance()
  await student.goto('/')
  await expect(student.getByText('You have a warning')).toBeVisible()
  await support.goto('/history')
  await expect(support.getByText('Marked automatically: this lesson was not confirmed in time.')).toBeVisible()
  await support.getByRole('link', { name: 'Statistics' }).click()
  await support.getByRole('button', { name: 'All time' }).click()
  await expect(support.getByText('You forgot to mark')).toBeVisible()

  await support.goto('/guide')
  await expect(support.getByText(/you must close the day or the hours/)).toBeVisible()
  await student.goto('/rules')
  await expect(student.getByText(/On the lesson day it cannot be moved/)).toBeVisible()
  await admin.goto('/rules')
  await expect(admin.getByRole('heading', { name: 'Guide and rules' })).toBeVisible()
  await admin.getByRole('tab', { name: 'For support teachers' }).click()
  await expect(admin.getByText(/you must close the day or the hours/)).toBeVisible()
  await expect(admin.getByRole('button', { name: 'Save as PDF / Print' })).toBeVisible()

  await admin.goto('/admin/students')
  await admin.getByRole('link', { name: 'Gulnoza Aliyeva' }).click()
  await admin.getByRole('button', { name: 'All time' }).click()
  await expect(admin.getByText('Ill, wrote in chat')).toBeVisible()
  await expect(admin.getByText('Automatic')).toBeVisible()
})

test('notifications are explained firmly, but the site never waits for them', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  const user = await createUser(admin, 'student', 'Shahlo', 'Nazarova')
  const student = await signIn(browser, user.login, user.password, { pushAsked: false })

  const dialog = student.getByRole('dialog', { name: 'Turn on notifications' })
  await expect(dialog.getByText(/you can get a penalty and not know why/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Turn on notifications' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Later' }).click()
  await expect(dialog).toBeHidden()

  await expect(student.getByText(/you can get a penalty and not know why/)).toBeVisible()
  await student.reload()
  await expect(student.getByRole('link', { name: 'Book a lesson' })).toBeVisible()
  await expect(dialog).toBeHidden()
})

test('closing today, the same-day exception, QR by phone camera, ranking, complaints and charts', async ({ browser }) => {
  await setNow('2030-12-02T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const temur = await createUser(admin, 'student', 'Temur', 'Rasulov')
  const student = await signIn(browser, temur.login, temur.password)
  const ozodbek = await signIn(browser, 'ozodbek.karimov', await resetPassword(admin, 'Ozodbek Karimov'))
  const malika = await signIn(browser, 'malika.rahimova', await resetPassword(admin, 'Malika Rahimova'))
  await bookFirstSlot(student, 'Ozodbek', 'Closed topic')

  await setNow('2030-12-03T10:00:00+05:00')
  await ozodbek.goto('/')
  await ozodbek.getByLabel('Date').fill('2030-12-03')
  await ozodbek.getByLabel('Reason (optional)').fill('Ill')
  await ozodbek.getByRole('button', { name: 'Close this time' }).click()
  await ozodbek.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(ozodbek.getByText('1 students were notified')).toBeVisible()
  await admin.goto('/alerts')
  await expect(admin.getByText('Closed on the day')).toBeVisible()

  await student.goto('/')
  await student.getByRole('button', { name: 'Cancel the lesson instead' }).click()
  await expect(student.getByText('You can book for today')).toBeVisible()
  await student.getByText('You can book for today').locator('..').getByRole('link', { name: 'Book a lesson' }).click()
  await supportCard(student, 'Malika').getByRole('button', { name: '15:00' }).click()
  await student.getByLabel('What do you want to study?').fill('Same day topic')
  await student.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(student.getByText('Your next lesson')).toBeVisible()

  await setNow('2030-12-03T15:05:00+05:00')
  await malika.goto('/')
  const asked = malika.waitForRequest(/checkin_code/)
  await malika.getByRole('button', { name: 'Came' }).click()
  const booking = (await asked).postDataJSON().p_booking
  await expect(malika.getByRole('dialog').getByRole('img')).toBeVisible()
  const shown = await malika.getByTestId('checkin-code').textContent()

  await student.goto(`/checkin?b=${booking}&c=${shown}`)
  await expect(student.getByText('You are checked in. Have a good lesson!')).toBeVisible()
  await expect(malika.getByRole('dialog')).toBeHidden({ timeout: 10000 })
  await malika.goto('/')
  await expect(malika.getByRole('button', { name: 'Change mark' })).toBeHidden()

  await student.goto('/')
  await expect(student.getByText(/You are number \d+ this month/)).toBeVisible()
  await student.goto('/top')
  await expect(student.getByRole('heading', { name: 'Top students' })).toBeVisible()
  await expect(student.getByRole('listitem').filter({ hasText: 'Temur Rasulov' })).toContainText('Lessons: 1')
  await student.getByRole('button', { name: 'All time' }).click()
  await expect(student.getByRole('listitem').filter({ hasText: 'Temur Rasulov' })).toBeVisible()

  await student.goto('/history')
  await student.getByRole('button', { name: 'Report a problem' }).first().click()
  await student.getByLabel('What happened?').fill('The room was locked')
  await student.getByRole('button', { name: 'Send to the center' }).click()
  await expect(student.getByText('The room was locked')).toBeVisible()
  await expect(student.getByText('Received', { exact: true })).toBeVisible()
  await admin.goto('/admin')
  await expect(admin.getByText(/Answer a complaint: Temur Rasulov/)).toBeVisible()
  await malika.goto('/history')
  await expect(malika.getByText('Temur Rasulov').first()).toBeVisible()
  await expect(malika.getByText('The room was locked')).toBeHidden()
  await admin.goto('/admin/complaints')
  await admin.getByLabel('Your answer').fill('We will fix the door')
  await admin.getByRole('button', { name: 'Send answer' }).click()
  await expect(admin.getByText('Answer sent.')).toBeVisible()
  await student.reload()
  await expect(student.getByText('We will fix the door')).toBeVisible()
  await expect(student.getByText('Answered', { exact: true })).toBeVisible()

  await student.getByRole('link', { name: 'Statistics' }).click()
  await expect(student.getByRole('heading', { name: 'Statistics' })).toBeVisible()
  await expect(student.locator('.recharts-surface').first()).toBeVisible()
  await student.getByRole('button', { name: 'Months' }).click()
  await expect(student.locator('.recharts-surface').first()).toBeVisible()
  expect(problemsOf(student)).toEqual([])
})

test('the guide explains each role, reminds new supports, and prints cleanly', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  const support = await signIn(browser, 'malika.rahimova', await resetPassword(admin, 'Malika Rahimova'))
  const user = await createUser(admin, 'student', 'Kamola', 'Rasulova')
  const student = await signIn(browser, user.login, user.password)

  await support.goto('/')
  await expect(support.getByText('New here? Read the guide first')).toBeVisible()
  await support.getByRole('link', { name: 'Open the guide' }).click()
  await expect(support.getByRole('heading', { name: 'Guide and rules' })).toBeVisible()
  await expect(support.getByRole('tab', { name: 'For support teachers' })).toHaveAttribute('aria-selected', 'true')
  await support.getByText('Confirming a lesson').click()
  await expect(support.getByText(/When the lesson starts, press Came/)).toBeVisible()
  await expect(support.getByText(/opens 10 minutes after the start/).first()).toBeVisible()
  await support.getByRole('tab', { name: 'For students' }).click()
  await expect(support.getByText('Booking a lesson')).toBeVisible()
  await support.goto('/')
  await expect(support.getByText('New here? Read the guide first')).toBeHidden()

  await student.goto('/guide')
  await expect(student.getByRole('tab')).toHaveCount(0)
  await expect(student.getByText('At the lesson: confirm with the QR code')).toBeVisible()
  await admin.goto('/guide')
  await expect(admin.getByRole('tab')).toHaveCount(3)
  await expect(admin.getByText('Watching for false marks')).toBeVisible()

  await student.emulateMedia({ media: 'print' })
  await expect(student.locator('header').first()).toBeHidden()
  await expect(student.getByRole('navigation')).toBeHidden()
  await expect(student.getByRole('heading', { name: 'Guide and rules' })).toBeVisible()
})

test('lesson now: a student next to a free support teacher asks for their nearest session', async ({ browser }) => {
  await setNow('2031-01-07T14:20:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const user = await createUser(admin, 'student', 'Nilufar', 'Karimova')
  const student = await signIn(browser, user.login, user.password)
  const support = await signIn(browser, 'malika.rahimova', await resetPassword(admin, 'Malika Rahimova'))

  await student.goto('/book')
  await expect(student.getByText('Nobody is free right now.')).toBeVisible()
  await support.goto('/')
  await support.getByRole('button', { name: "I'm at the center" }).click()
  await expect(support.getByRole('button', { name: 'I left the center' })).toBeVisible()

  await student.goto('/book')
  await expect(student.getByRole('heading', { name: 'Lesson now' })).toBeVisible()
  const offer = student.getByRole('listitem').filter({ hasText: 'Malika Rahimova' })
  await expect(offer).toContainText('Lesson at 14:30')
  await offer.getByRole('button', { name: 'Ask for a lesson now' }).click()
  const dialog = student.getByRole('dialog', { name: 'Lesson now with Malika Rahimova' })
  await expect(dialog.getByText(/only when you are standing next to/)).toContainText('14:30')
  await dialog.getByLabel('Topic (optional)').fill('Quick speaking')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(student.getByText('Waiting for Malika Rahimova to accept the 14:30 lesson.')).toBeVisible()
  const timer = student.getByRole('timer')
  await expect(timer).toHaveText(/^[0-5]:[0-5]\d$/)
  const shown = await timer.textContent()
  await expect(timer).not.toHaveText(shown ?? '')

  await support.goto('/')
  await expect(support.getByText('Lesson now requests')).toBeVisible()
  await expect(support.getByText('Quick speaking')).toBeVisible()
  await expect(support.getByText('Lesson at 14:30')).toBeVisible()
  await support.getByRole('button', { name: 'Accept' }).click()
  await expect(support.getByText('Accepted. The lesson is booked.')).toBeVisible()
  await expect(support.getByText('Lesson now', { exact: true }).first()).toBeVisible()

  await expect(student.getByText('Malika Rahimova accepted. Your lesson starts at 14:30.')).toBeVisible({ timeout: 10000 })
  await setNow('2031-01-07T14:31:00+05:00')
  await support.reload()
  await expect(support.getByRole('button', { name: 'Came' })).toBeVisible()
  await student.goto('/')
  await expect(student.getByText('Lesson time: confirm you came')).toBeVisible()

  await admin.goto('/admin/bookings')
  await admin.getByLabel('From').fill('2031-01-07')
  await admin.getByLabel('To', { exact: true }).fill('2031-01-07')
  await expect(admin.getByText('Lesson now').first()).toBeVisible()
})

test('a taken time offers the nearest free ones, and keeps the topic', async ({ browser }) => {
  await setNow('2030-08-05T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const first = await createUser(admin, 'student', 'Lola', 'Saidova')
  const second = await createUser(admin, 'student', 'Sardor', 'Komilov')
  const slow = await signIn(browser, first.login, first.password)
  const quick = await signIn(browser, second.login, second.password)

  await slow.goto('/book')
  await supportCard(slow, 'Malika').getByRole('button', { name: '14:30' }).click()
  const dialog = slow.getByRole('dialog')
  await expect(dialog.getByText(/14:30-15:00 · 30 min/)).toBeVisible()
  await dialog.getByLabel('What do you want to study?').fill('Articles')

  await bookFirstSlotAt(quick, 'Malika', '14:30', 'Quick one')
  await dialog.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(dialog.getByText('Someone just took this time')).toBeVisible()
  await dialog.getByRole('button', { name: /^14:00 · Malika/ }).click()
  await expect(dialog.getByLabel('What do you want to study?')).toHaveValue('Articles')
  await dialog.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(slow.locator('section.hero')).toContainText('14:00')
  await expect(slow.getByText(/If you cancel, you can book again from .*00:00/)).toBeVisible()
})

test('every page fits a phone screen, for each role, and a foreign chat is explained', async ({ browser }) => {
  await setNow('2030-08-05T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const pupil = await createUser(admin, 'student', 'Kamola', 'Rustamova')
  const password = await resetPassword(admin, 'Malika Rahimova')
  const student = await signIn(browser, pupil.login, pupil.password)
  const support = await signIn(browser, 'malika.rahimova', password)
  await expect(support.getByRole('heading', { name: /^Tomorrow · / })).toBeVisible()
  await expect(support.getByText('2 lessons')).toBeVisible()
  const pages: [Page, string[]][] = [
    [student, ['/', '/book', '/supports', '/history', '/top', '/chat', '/alerts', '/profile', '/guide']],
    [support, ['/', '/calendar', '/history', '/chat', '/alerts', '/profile', '/guide']],
    [admin, ['/admin', '/admin/bookings', '/admin/students', '/admin/supports', '/admin/days', '/admin/penalties',
      '/admin/reviews', '/admin/complaints', '/admin/chats', '/admin/stats', '/admin/settings', '/admin/texts', '/admin/audit', '/admin/errors']],
  ]
  for (const [page, paths] of pages) {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const path of paths) {
      await page.goto(path)
      await expect(page.locator('h1').first()).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `${path} is wider than a phone`).toBeLessThanOrEqual(1)
    }
  }
  await student.goto('/chat/00000000-0000-0000-0000-000000000000')
  await expect(student.getByText('This chat is not available')).toBeVisible()
  expect(problemsOf(student).filter((text) => !/status of (403|404)/.test(text))).toEqual([])
})

test('statistics show the real numbers even when the page gets no animation frames', async ({ browser }) => {
  const admin = await signIn(browser, 'admin', 'admin12345')
  await admin.addInitScript(() => {
    window.requestAnimationFrame = () => 0
  })
  await admin.goto('/admin')
  const tile = admin.getByText('Support teachers', { exact: true }).locator('xpath=..')
  await expect(tile.locator('p').nth(1)).not.toHaveText('0')
  await expect(tile.locator('p').nth(1)).toHaveText(/^[1-9][0-9]*$/)
})

test('an unexpected error reaches the developer with who, where and what', async ({ browser }) => {
  await setNow('2031-05-05T10:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  const user = await createUser(admin, 'student', 'Sardor', 'Xatoyev')
  const student = await signIn(browser, user.login, user.password)

  await student.route('**/rpc/book_lesson', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'XX000', message: 'e2e: the booking table exploded', details: null, hint: null }),
  }))
  await student.goto('/book')
  await supportCard(student, 'Ozodbek').getByRole('button', { name: '14:00' }).click()
  await student.getByLabel('What do you want to study?').fill('Error report test')
  await student.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(student.getByText('Something went wrong. Try again.')).toBeVisible()

  await admin.goto('/admin/errors')
  const card = admin.locator('section').filter({ hasText: 'e2e: the booking table exploded' })
  await expect(async () => {
    await admin.reload()
    await expect(card).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await expect(card.getByText('request book_lesson')).toBeVisible()
  await admin.getByRole('button', { name: 'Open menu' }).click()
  await expect(admin.getByRole('link', { name: /^Errors\s*\d/ })).toBeVisible()
  await admin.getByRole('button', { name: 'Close menu' }).last().click()
  await card.getByText(/Show 1 case/).click()
  await expect(card.getByRole('link', { name: 'Sardor Xatoyev' })).toBeVisible()
  await expect(card.getByText(/Error report test/)).toBeVisible()
  await expect(card.getByText('Page /book')).toBeVisible()

  await admin.goto('/alerts')
  await expect(admin.getByText(/Sardor Xatoyev \(student\): e2e: the booking table exploded/)).toBeVisible()

  await admin.goto('/admin/errors')
  await card.getByRole('button', { name: 'Mark fixed' }).click()
  await expect(card).toBeHidden()
  await admin.getByRole('button', { name: 'Fixed', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Not fixed yet' })).toBeVisible()

  await admin.goto('/admin/users/00000000-0000-0000-0000-000000000000')
  await expect(admin.getByText('This account no longer exists')).toBeVisible()
})

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('support teachers scan in and out with the reception QR, their location and a face check', async ({ browser }) => {
  await setNow('2032-03-02T09:00:00+05:00')
  const admin = await signIn(browser, 'admin', 'admin12345')
  await admin.context().grantPermissions(['geolocation'])
  await admin.context().setGeolocation({ latitude: 40.3864, longitude: 71.7864 })
  const dilnoza = await createUser(admin, 'support', 'Dilnoza', 'Yusupova')
  await setHours(admin, 'Dilnoza Yusupova')

  await admin.getByLabel('Face photo file').setInputFiles({
    name: 'dilnoza.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG, 'base64'),
  })
  await expect(admin.getByText('Photo saved.')).toBeVisible()
  await expect(admin.getByRole('img', { name: 'Face photo' })).toBeVisible()

  await admin.goto('/admin/settings')
  await admin.getByLabel('Support teacher attendance').check()
  await admin.getByRole('button', { name: "Use this device's location" }).click()
  await expect(admin.getByRole('textbox', { name: 'Center location' })).toHaveValue('40.386400, 71.786400')
  await admin.getByRole('button', { name: 'Save 2 changes' }).click()
  await expect(admin.getByText('Settings saved.')).toBeVisible()

  const support = await signIn(browser, dilnoza.login, dilnoza.password)
  await support.context().grantPermissions(['geolocation'])
  await support.context().setGeolocation({ latitude: 40.387, longitude: 71.787 })
  await support.evaluate(() => localStorage.setItem('fake-face', 'dilnoza'))
  await runMaintenance()
  await support.goto('/')
  await expect(support.getByText('Your attendance today')).toBeVisible()
  await expect(support.getByText('Work time 14:00-18:00')).toBeVisible()
  await expect(support.getByText('Not scanned in yet')).toBeVisible()
  await expect(support.getByRole('button', { name: "I'm at the center" })).toBeHidden()

  await admin.goto('/admin/attendance/qr')
  const qr = admin.getByTestId('attend-qr')
  const nextCode = async () => {
    await admin.reload()
    await expect(qr).toHaveAttribute('data-code', /\w{32}/)
    return qr.getAttribute('data-code')
  }

  await setNow('2032-03-02T14:12:00+05:00')
  await support.goto(`/attend?c=${await nextCode()}`)
  await support.getByRole('button', { name: 'Look at the camera' }).click()
  await expect(support.getByText('Welcome! Arrived at 14:12.')).toBeVisible()
  await expect(support.getByText('12 min late')).toBeVisible()
  await expect(admin.getByText('Dilnoza Yusupova — arrived 14:12')).toBeVisible()

  await setNow('2032-03-02T16:00:00+05:00')
  await support.evaluate(() => localStorage.setItem('fake-face', 'somebody else'))
  await support.goto(`/attend?c=${await nextCode()}`)
  await expect(support.getByText('Your work time ends at 18:00. Leaving now counts as leaving early.')).toBeVisible()
  await support.getByRole('button', { name: 'Leave now' }).click()
  await support.getByRole('button', { name: 'Look at the camera' }).click()
  await expect(support.getByText('The face did not match. Tries left: 2.')).toBeVisible()
  await support.getByRole('button', { name: 'Close' }).click()

  await support.context().setGeolocation({ latitude: 40.45, longitude: 71.8 })
  await support.goto(`/attend?c=${await nextCode()}`)
  await expect(support.getByText('Your phone is not at the center. Scanning works only at the center.')).toBeVisible()

  await setNow('2032-03-02T18:05:00+05:00')
  await support.context().setGeolocation({ latitude: 40.387, longitude: 71.787 })
  await support.evaluate(() => localStorage.setItem('fake-face', 'dilnoza'))
  await support.goto(`/attend?c=${await nextCode()}`)
  await support.getByRole('button', { name: 'Look at the camera' }).click()
  await expect(support.getByText('Goodbye! Left at 18:05.')).toBeVisible()
  await expect(support.getByRole('button', { name: 'Scan the QR at reception' })).toBeHidden()

  await admin.goto('/admin/attendance')
  const row = admin.getByRole('row').filter({ hasText: 'Dilnoza Yusupova' })
  await expect(row).toContainText('Left')
  await expect(row).toContainText('12 min late')
  await expect(row).toContainText('Face failed 1×')
  await row.getByRole('button', { name: 'Photos' }).click()
  const photos = admin.getByRole('dialog', { name: /Face checks: Dilnoza Yusupova/ })
  await expect(photos.getByText('No match')).toBeVisible()
  await expect(photos.getByText('Match', { exact: true })).toHaveCount(2)
  await photos.getByRole('button', { name: 'Close' }).click()

  await admin.getByRole('tab', { name: 'Month' }).click()
  await admin.getByLabel('Month').fill('2032-03')
  const summary = admin.getByRole('row').filter({ hasText: 'Dilnoza Yusupova' }).first()
  await expect(summary).toContainText('12 min')
  const download = admin.waitForEvent('download')
  await admin.getByRole('button', { name: 'Download Excel' }).click()
  expect((await download).suggestedFilename()).toBe('attendance-2032-03.xlsx')

  await setNow('2032-03-03T09:00:00+05:00')
  await support.goto('/attendance')
  await expect(support.getByText('Tue 2 Mar')).toBeVisible()
  await expect(support.getByText('Arrived 14:12')).toBeVisible()

  expect(problemsOf(support)).toEqual([])
  expect(problemsOf(admin)).toEqual([])

  await admin.goto('/admin/settings')
  await admin.getByLabel('Support teacher attendance').uncheck()
  await admin.getByRole('button', { name: 'Save 1 change' }).click()
  await expect(admin.getByText('Settings saved.')).toBeVisible()
})
